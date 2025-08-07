// File: api/loader.js
// Vercel Serverless Function - v1.6 (URL-Controlled Branching)

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// Define the default production branch and allowed testing branches
const PRODUCTION_BRANCH = 'main';
const ALLOWED_TEST_BRANCHES = ['test']; // You can add more later, e.g., ['test', 'staging']

/**
 * Fetches a file from a specific branch in the GitHub repository.
 * @param {string} path - The path to the file in the repository.
 * @param {string} ref - The git branch, tag, or commit SHA.
 * @returns {Promise<string|null>} The file content as text, or null if not found.
 */
async function getFileFromGitHub(path, ref) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${ref}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3.raw'
  };

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(`File not found at path ${path} in branch ${ref}`);
      return null;
    }
    throw new Error(`GitHub API request failed for path ${path} in branch ${ref}: ${response.statusText}`);
  }
  return response.text();
}

export default async function handler(request, response) {
  // Handle OPTIONS requests for CORS preflight. This must come first.
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return response.status(204).send('');
  }

  try {
    const url = new URL(request.url, `https://${request.headers.host}`);
    
    // --- BRANCH SELECTION LOGIC ---
    // Check for a 'bp_branch' query parameter to select the git branch.
    const requestedBranch = url.searchParams.get('bp_branch');
    let sourceBranch = PRODUCTION_BRANCH;
    let isTestMode = false;

    if (requestedBranch && ALLOWED_TEST_BRANCHES.includes(requestedBranch)) {
      sourceBranch = requestedBranch;
      isTestMode = true;
      console.log(`Request is in test mode, targeting branch: "${sourceBranch}"`);
    }

    // --- CUSTOMER ID PARSING ---
    let customerId = null;
    const queryId = url.searchParams.get('id');
    if (queryId) {
      customerId = queryId;
    } else {
      let pathId = url.pathname;
      if (pathId.startsWith('/')) { pathId = pathId.slice(1); }
      if (pathId) {
        if (pathId.endsWith('/')) { pathId = pathId.slice(0, -1); }
        if (pathId.endsWith('.js')) { pathId = pathId.slice(0, -3); }
        customerId = pathId;
      }
    }

    if (!customerId) {
      return response.status(400).send('// Error: Customer ID could not be determined.');
    }

    console.log(`Processing request for customer: "${customerId}" from branch: "${sourceBranch}"`);

    // --- FILE FETCHING ---
    const coreScriptPath = 'configs/chatbot-core.js';
    const customerConfigPath = `configs/customers/${customerId}.json`;

    const [coreJsContent, customerJsonContent] = await Promise.all([
      getFileFromGitHub(coreScriptPath, sourceBranch),
      getFileFromGitHub(customerConfigPath, sourceBranch)
    ]);

    let finalConfigContent = customerJsonContent;
    if (!finalConfigContent) {
      console.warn(`Config for customer "${customerId}" in branch "${sourceBranch}" not found. Falling back to default.`);
      finalConfigContent = await getFileFromGitHub('configs/default.json', sourceBranch);
      if (!finalConfigContent) {
        return response.status(404).send(`// Error: Default configuration could not be found in branch "${sourceBranch}".`);
      }
    }

    if (!coreJsContent) {
      return response.status(500).send(`// Error: Core chatbot script could not be loaded from branch "${sourceBranch}".`);
    }

    const finalScript = `// Source Branch: ${sourceBranch}\nwindow.ChatWidgetConfig = ${finalConfigContent};\n\n${coreJsContent}`;

    // --- HEADER CONFIGURATION ---
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');

    // Set cache headers based on whether we are in test mode.
    if (isTestMode) {
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      console.log('Cache disabled for test mode request.');
    } else {
      response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      console.log('Production cache set for default request.');
    }

    return response.status(200).send(finalScript);

  } catch (error) {
    console.error('An error occurred in the proxy loader:', error);
    response.setHeader('Access-Control-Allow-Origin', '*');
    return response.status(500).send('// Server Error: Could not process the request.');
  }
}
