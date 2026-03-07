require('dotenv').config();
const express = require('express');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;
const TATUM_API_KEY = process.env.TATUM_API_KEY;

// Validate API key on startup
if (!TATUM_API_KEY) {
  console.error('missing TATUM_API_KEY, set it in the .env file');
  process.exit(1);
}

// Run the KMS daemon as a background process.
// It polls Tatum for pending signing requests, signs and broadcasts them,
// then calls the completion endpoint with the txId.
function startKmsDaemon() {
  const period = process.env.KMS_PERIOD || '5';
  const externalUrl = process.env.KMS_EXTERNAL_URL;
  const chains = process.env.KMS_CHAINS;

  if (!externalUrl) {
    console.error('KMS_EXTERNAL_URL is required for the daemon. Set it to the public URL of this service.');
    process.exit(1);
  }

  const args = ['/opt/app/dist/index.js', 'daemon', `--period=${period}`, `--external-url=${externalUrl}`];
  if (chains) args.push(`--chains=${chains}`);

  console.log(`Starting KMS daemon: period=${period}s, externalUrl=${externalUrl}, chains=${chains || 'all'}`);

  const daemon = spawn('node', args, { env: { ...process.env }, stdio: 'inherit' });

  daemon.on('error', (err) => {
    console.error('KMS daemon spawn error:', err.message);
  });

  daemon.on('close', (code) => {
    console.error(`KMS daemon exited with code ${code}. Restarting in 10s...`);
    setTimeout(startKmsDaemon, 10000);
  });
}

startKmsDaemon();

app.use(express.json());

async function executeTatumCommand(command, args = []) {
  try {
    const argString = args.join(' ');
    const fullCommand = `node /opt/app/dist/index.js ${command} ${argString}`;

    console.log(`Executing: ${fullCommand}`);

    const env = {
      ...process.env,
      TATUM_API_KEY: TATUM_API_KEY
    };

    const { stdout, stderr } = await execAsync(fullCommand, { env });

    if (stderr && !stderr.includes('Warning') && !stderr.includes('bigint')) {
      console.error('Command stderr:', stderr);
    }

    let parsedOutput = null;
    try {
      parsedOutput = JSON.parse(stdout.trim());
    } catch (parseError) {
      console.warn('Could not parse command output as JSON, returning as string.', parseError.message);
    }

    return {
      success: true,
      output: parsedOutput !== null ? parsedOutput : stdout.trim(),
      raw: stdout
    };
  } catch (error) {
    console.error('Command error:', error.message);
    return {
      success: false,
      error: error.message,
      stderr: error.stderr
    };
  }
}


// Generate wallet endpoint
app.post('/api/wallet/generate', async (req, res) => {
  try {
    const { chain, mnemonic, testnet } = req.body;

    if (!chain) {
      return res.status(400).json({ error: 'Chain is required (e.g., ETH, BTC, MATIC)' });
    }

    const args = [chain];

    // if (testnet) {
    if (true) {
      args.push('--testnet');
    }

    if (mnemonic) {
      args.push('--mnemonic', `"${mnemonic}"`);
    }

    const result = await executeTatumCommand('generatemanagedwallet', args);

    res.json(result);
  } catch (error) {
    console.error('Error generating wallet:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`running on port ${PORT}`);
});
