# Sourced by amplify.yml (it changes the shell's Node, so it cannot run as its own process).
# Uses the build image's newest Node 20 when it satisfies package.json's engines (>= 20.19), and
# installs the latest Node 20 only when it does not. It puts that Node first on PATH itself:
# `nvm use` took ~20 s of every build.
usable_node() {
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 20 && minor >= 19 ? 0 : 1)' 2>/dev/null
}
if ! usable_node; then
  node20=$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v20.* 2>/dev/null | sort -V | tail -n 1)
  [ -n "$node20" ] && export PATH="$node20/bin:$PATH"
fi
if ! usable_node; then
  echo "No usable Node 20 on the image: installing it"
  nvm install 20
fi
echo "Using Node $(node -v)"
