#!/usr/bin/env python3
"""Renders the public API's documentation for each active branch.

Reads docs/openapi/public-api.yaml (the one document that is edited by hand) and writes,
per branch, docs/openapi/branches/<branch>/openapi.yaml and a branded index.html.

A branch is active when it has a row in .claude/skills/aws-logs/environments.tsv and its
Amplify app still has that branch. From the branch's own AWS account (read-only) it takes:
  - the public API's and the WebSocket's URLs, from the Amplify stack's outputs
  - the brand, from SSM /loudibly/api/BRAND_NAME
  - the coins an account can hold: the native ones, plus each token with a ready master
Wording, colours and logo come from branding.yaml beside this script.

  render.py                     every active branch
  render.py --branch main       one branch (repeatable)
  render.py --offline           no AWS: brand from branding.yaml, URLs left as variables
"""
import argparse
import base64
import datetime
import html
import json
import mimetypes
import os
import re
import subprocess
import sys

import yaml

SKILL = os.path.dirname(os.path.abspath(__file__))
ROOT = subprocess.run(['git', '-C', SKILL, 'rev-parse', '--show-toplevel'],
                      capture_output=True, text=True, check=True).stdout.strip()
ENVIRONMENTS = os.path.join(ROOT, '.claude/skills/aws-logs/environments.tsv')
BASE = os.path.join(ROOT, 'docs/openapi/public-api.yaml')
OUT = os.path.join(ROOT, 'docs/openapi/branches')
API_NAME = 'loudiblyPublicApi'

# The networks' own coins need no master (NETWORKS in amplify/utils/currencies.ts)
NATIVE = ['TRON', 'SOL']
TEST_TOKENS = {'TUSDT_TRON': 'USDT on the TRON test network'}

REDOC = 'https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js'


class Skip(Exception):
    pass


def fail(message):
    print(f'error: {message}', file=sys.stderr)
    sys.exit(1)


def read_environments():
    rows = {}
    with open(ENVIRONMENTS) as f:
        for line in f:
            fields = line.split()
            if not fields or fields[0].startswith('#'):
                continue
            branch, account, region, profile, app_id = fields[:5]
            rows[branch] = {'account': account, 'region': region, 'profile': profile, 'appId': app_id}
    return rows


def aws(env, *args):
    result = subprocess.run(
        ['aws', '--profile', env['profile'], '--region', env['region'], '--output', 'json', *args],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f'aws {args[0]} {args[1]} failed')
    return json.loads(result.stdout) if result.stdout.strip() else None


def read_branch(branch, env):
    """What the branch's account says about it. Read-only."""
    account = aws(env, 'sts', 'get-caller-identity')['Account']
    if account != env['account']:
        raise Skip(f"profile {env['profile']} is account {account}, but {branch} expects {env['account']}")

    try:
        aws(env, 'amplify', 'get-branch', '--app-id', env['appId'], '--branch-name', branch)
    except RuntimeError as e:
        if 'NotFoundException' in str(e):
            raise Skip(f"Amplify app {env['appId']} has no branch {branch}")
        raise

    brand = aws(env, 'ssm', 'get-parameter', '--name', '/loudibly/api/BRAND_NAME')['Parameter']['Value']

    endpoint = websocket = None
    stacks = aws(env, 'cloudformation', 'describe-stacks')['Stacks']
    for stack in stacks:
        tags = {t['Key']: t['Value'] for t in stack.get('Tags', [])}
        if stack.get('ParentId') or tags.get('amplify:app-id') != env['appId'] or tags.get('amplify:branch-name') != branch:
            continue
        for output in stack.get('Outputs', []):
            if output['OutputKey'] == 'customOutputs':
                custom = json.loads(output['OutputValue']).get('custom', {})
                api = custom.get('API', {}).get(API_NAME)
                if api:
                    endpoint = api['endpoint'].rstrip('/')
                if custom.get('WebSocket', {}).get('endpoint'):
                    websocket = custom['WebSocket']['endpoint'].rstrip('/')

    masters = aws(env, 'dynamodb', 'scan', '--table-name', 'v1MerchantTable',
                  '--filter-expression', 'begins_with(sk, :m) AND #s = :ready',
                  '--expression-attribute-names', '{"#s": "status"}',
                  '--expression-attribute-values', '{":m": {"S": "MASTER#"}, ":ready": {"S": "ready"}}',
                  '--projection-expression', 'sk')['Items']
    tokens = sorted({item['sk']['S'].removeprefix('MASTER#') for item in masters})

    return {'brand': brand, 'endpoint': endpoint, 'websocket': websocket, 'currencies': NATIVE + tokens}


def currency_schema(currencies):
    notes = [f'`{c}` is {TEST_TOKENS[c]}.' for c in currencies if c in TEST_TOKENS]
    return {
        'type': 'string',
        'description': ' '.join(['What an account can hold on this environment.', *notes]),
        'enum': currencies,
    }


def websocket_url(env, facts, settings):
    return (settings.get('websocketUrl') or facts.get('websocket')
            or f"wss://{{websocketApiId}}.execute-api.{env['region']}.amazonaws.com/v1")


def render_spec(base, branch, env, facts, brand, settings):
    # Deep copy, with the branch's WebSocket URL wherever the text says {websocketUrl}
    spec = json.loads(json.dumps(base).replace('{websocketUrl}', websocket_url(env, facts, settings)))
    environment = settings.get('environment')
    info = spec['info']

    # The name carries the version: "NODA API v2.0.4 (Test)"
    name = f"{brand['title']} v{info['version']}"
    info['title'] = f"{name} ({environment})" if environment else name
    # The base's first paragraph names the product; the rest is the same everywhere
    rest = info['description'].split('\n\n', 1)[1]
    parts = [brand['summary'].strip(), (settings.get('description') or '').strip(), rest]
    info['description'] = '\n\n'.join(p for p in parts if p)

    url = settings.get('serverUrl') or facts['endpoint']
    label = f"{brand['title']}, {environment}" if environment else brand['title']
    if url:
        spec['servers'] = [{'url': url, 'description': label}]
    else:
        spec['servers'] = [{
            'url': f"https://{{apiId}}.execute-api.{env['region']}.amazonaws.com/v1",
            'description': f'{label}. Not deployed yet: the URL is read again on the next render.',
            'variables': {'apiId': {'default': 'not-deployed', 'description': f'The {API_NAME} id'}},
        }]

    if facts['currencies']:
        spec['components']['schemas']['Currency'] = currency_schema(facts['currencies'])
        fix_examples(spec, facts['currencies'])
    return spec


def fix_examples(node, currencies):
    """An example may only name a coin this branch can hold: a token for a token, else the first."""
    tokens = [c for c in currencies if c not in NATIVE]
    if isinstance(node, dict):
        example = node.get('example')
        if isinstance(example, dict) and example.get('chain') and example['chain'] not in currencies:
            native = example['chain'] in NATIVE
            example['chain'] = (tokens[0] if tokens and not native else currencies[0])
        for value in node.values():
            fix_examples(value, currencies)
    elif isinstance(node, list):
        for value in node:
            fix_examples(value, currencies)


class LiteralDumper(yaml.SafeDumper):
    pass


def _str(dumper, value):
    style = '|' if '\n' in value else None
    return dumper.represent_scalar('tag:yaml.org,2002:str', value, style=style)


LiteralDumper.add_representer(str, _str)


def data_uri(repo_path):
    path = os.path.join(ROOT, repo_path)
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    with open(path, 'rb') as f:
        return f'data:{mime};base64,{base64.b64encode(f.read()).decode()}'


def render_html(spec, brand, settings):
    colors = brand['colors']
    environment = settings.get('environment') or ''
    mark = (f'<img src="{data_uri(brand["logo"])}" alt="{html.escape(brand["title"])}">'
            if brand.get('logo') else f'<span class="name">{html.escape(brand["title"])}</span>')
    # A JSON island: only "</" could end the script element early
    spec_json = json.dumps(spec).replace('</', '<\\/')
    options = {
        'hideDownloadButton': False,
        'expandResponses': '200,201',
        'theme': {
            'colors': {'primary': {'main': colors['primary']}},
            'typography': {'fontFamily': 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
                           'headings': {'fontFamily': 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'}},
            'sidebar': {'width': '280px'},
        },
    }
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(spec["info"]["title"])}</title>
<style>
  :root {{ --header: {colors["header"]}; --on-header: {colors["onHeader"]}; }}
  body {{ margin: 0; background: #fff; }}
  header {{ display: flex; align-items: center; gap: 16px; padding: 14px 16px; background: var(--header); color: var(--on-header);
    font: 600 16px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }}
  header img {{ height: 28px; width: auto; }}
  header .env {{ margin-left: auto; padding: 4px 10px; border: 1px solid currentColor; border-radius: 999px; font-size: 12px; font-weight: 500; }}
</style>
</head>
<body>
<header>{mark}<span>API reference</span>{f'<span class="env">{html.escape(environment)}</span>' if environment else ''}</header>
<div id="redoc"></div>
<script id="spec" type="application/json">{spec_json}</script>
<script src="{REDOC}"></script>
<script>
  Redoc.init(JSON.parse(document.getElementById('spec').textContent), {json.dumps(options)}, document.getElementById('redoc'))
</script>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--branch', action='append', help='render only this branch (repeatable)')
    parser.add_argument('--offline', action='store_true', help='no AWS calls')
    args = parser.parse_args()

    environments = read_environments()
    with open(os.path.join(SKILL, 'branding.yaml')) as f:
        branding = yaml.safe_load(f)
    with open(BASE) as f:
        base = yaml.safe_load(f)

    branches = args.branch or list(environments)
    unknown = [b for b in branches if b not in environments]
    if unknown:
        fail(f"no row in {os.path.relpath(ENVIRONMENTS, ROOT)} for {', '.join(unknown)}")

    commit = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'],
                            capture_output=True, text=True).stdout.strip()
    today = datetime.date.today().isoformat()
    written, skipped = [], []

    for branch in branches:
        env = environments[branch]
        settings = (branding.get('branches') or {}).get(branch) or {}
        try:
            if args.offline:
                if not settings.get('brand'):
                    raise Skip('offline needs `brand` under its entry in branding.yaml')
                facts = {'brand': settings['brand'], 'endpoint': None, 'websocket': None, 'currencies': None}
            else:
                facts = read_branch(branch, env)
        except Skip as e:
            skipped.append(f'{branch}: {e}')
            continue
        except RuntimeError as e:
            skipped.append(f'{branch}: AWS call failed: {e}')
            continue

        brand_name = settings.get('brand') or facts['brand']
        brand = (branding.get('brands') or {}).get(brand_name)
        if not brand:
            skipped.append(f'{branch}: brand {brand_name!r} has no entry under `brands` in branding.yaml')
            continue

        spec = render_spec(base, branch, env, facts, brand, settings)
        folder = os.path.join(OUT, re.sub(r'[^A-Za-z0-9_.-]', '-', branch))
        os.makedirs(folder, exist_ok=True)

        header = (f'# Generated by .claude/skills/api-docs/render.py for branch {branch}\n'
                  f'# from docs/openapi/public-api.yaml at {commit}, {today}. Edit those, not this.\n')
        with open(os.path.join(folder, 'openapi.yaml'), 'w') as f:
            f.write(header + yaml.dump(spec, Dumper=LiteralDumper, sort_keys=False, allow_unicode=True, width=100))
        with open(os.path.join(folder, 'index.html'), 'w') as f:
            f.write(render_html(spec, brand, settings))

        server = spec['servers'][0]['url']
        currencies = ', '.join(facts['currencies'] or base['components']['schemas']['Currency']['enum'])
        written.append(f'{branch}: {brand_name}, {settings.get("environment") or "no environment label"}, '
                       f'{server}, {websocket_url(env, facts, settings)}, coins {currencies} -> {os.path.relpath(folder, ROOT)}/')

    for line in written:
        print(f'wrote   {line}')
    for line in skipped:
        print(f'skipped {line}')
    sys.exit(1 if skipped and not written else 0)


if __name__ == '__main__':
    main()
