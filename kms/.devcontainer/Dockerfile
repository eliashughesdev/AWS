FROM tatumio/tatum-kms:latest

WORKDIR /workspace

# Override the entrypoint to use shell instead of tatum-kms directly
# This allows us to run both Node.js API and tatum-kms commands
ENTRYPOINT ["/bin/sh", "-c"]

# Keep container running for devcontainer
CMD ["tail -f /dev/null"]