#!/usr/bin/env bash
# Run by amplify.yml. Deploys the backend only when its inputs changed since this branch's last
# deploy; otherwise it only writes amplify_outputs.json from the deployed stack, which the
# frontends build against. The inputs are everything a deploy is built from: amplify/ and the
# root package.json and yarn.lock (nothing in amplify/ reads the environment at synth time).
# Set FORCE_BACKEND_DEPLOY=true on the branch in the Amplify console to deploy regardless.
set -euo pipefail

param="/amplify/ci/$AWS_APP_ID/$AWS_BRANCH/backend-inputs"
inputs=$(git rev-parse HEAD:amplify HEAD:package.json HEAD:yarn.lock | sha256sum | cut -d' ' -f1)
# Unreadable or missing (first build, no permission) counts as changed
deployed=$(aws ssm get-parameter --name "$param" --query Parameter.Value --output text 2>/dev/null || echo none)

if [ "${FORCE_BACKEND_DEPLOY:-}" != "true" ] && [ "$inputs" = "$deployed" ]; then
  echo "Backend inputs $inputs unchanged since the last deploy: skipping pipeline-deploy"
  yarn ampx generate outputs --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"
  exit 0
fi

if [ "${FORCE_BACKEND_DEPLOY:-}" = "true" ]; then
  echo "FORCE_BACKEND_DEPLOY is set: deploying backend inputs $inputs"
else
  echo "Backend inputs $inputs differ from the last deploy ($deployed): deploying"
fi
yarn ampx pipeline-deploy --branch "$AWS_BRANCH" --app-id "$AWS_APP_ID"
# Recorded only after a deploy that succeeded. If this fails the next build deploys again.
aws ssm put-parameter --name "$param" --value "$inputs" --type String --overwrite >/dev/null \
  || echo "Warning: could not record the deployed backend inputs; the next build will deploy again"
