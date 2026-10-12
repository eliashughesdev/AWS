# Sourced by amplify.yml (it changes the shell's Node, so it cannot run as its own process).
# Uses the build image's Node 20 when it satisfies package.json's engines (>= 20.19), and
# installs the latest Node 20 only when it does not.
if ! { nvm use 20 >/dev/null 2>&1 \
  && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 20 && minor >= 19 ? 0 : 1)'; }; then
  echo "No usable Node 20 on the image: installing it"
  nvm install 20
fi
echo "Using Node $(node -v)"
