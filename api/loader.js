// File: api/loader.js
// Vercel Serverless Function - v1.5 (Full CORS & Environment Fix)

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// Determine the branch from Vercel's environment variables. Default to 'main'.
const GIT_BRANCH = process.env.VERCEL_GIT_COMMIT_REF || 'main';
// Determine the environment from Vercel's system variables.
const VERCEL_ENV = process.env.VERCEL_ENV || 'development';

/**
 * Fetches a file from a specific branch in the GitHub repository.
 * @param {string} path - The path to the file in the repository.
 * @param {string} ref - The git branch, tag, or commit SHA.
 * @returns {Promise<string|null>} The file content as text, or null if not found.
 */
async function getFileFromGitHub(path, ref) {
  // Construct the URL to fetch the file from a specific ref (branch)
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
  // --- PREFLIGHT REQUEST (CORS) ---
  // Handle OPTIONS requests for CORS preflight. This must come before any other logic.
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return response.status(204).send('');
  }

  try {
    const url = new URL(request.url, `https://${request.headers.host}`);
    let customerId = null;

    // Flexible Customer ID parsing (from query param or path)
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

    console.log(`Processing request for customer: "${customerId}" on branch: "${GIT_BRANCH}"`);

    const coreScriptPath = 'configs/chatbot-core.js';
    const customerConfigPath = `configs/customers/${customerId}.json`;

    // Fetch files from the determined git branch
    const [coreJsContent, customerJsonContent] = await Promise.all([
      getFileFromGitHub(coreScriptPath, GIT_BRANCH),
      getFileFromGitHub(customerConfigPath, GIT_BRANCH)
    ]);

    let finalConfigContent = customerJsonContent;
    if (!finalConfigContent) {
      console.warn(`Config for customer "${customerId}" in branch "${GIT_BRANCH}" not found. Falling back to default.`);
      finalConfigContent = await getFileFromGitHub('configs/default.json', GIT_BRANCH);
      if (!finalConfigContent) {
        return response.status(404).send('// Error: Default configuration could not be found in branch "${GIT_BRANCH}".');
      }
    }

    if (!coreJsContent) {
      return response.status(500).send('// Error: Core chatbot script could not be loaded from branch "${GIT_BRANCH}".');
    }

    const finalScript = `// Vercel Env: ${VERCEL_ENV} | Branch: ${GIT_BRANCH}\nwindow.ChatWidgetConfig = ${finalConfigContent};\n\n${coreJsContent}`;

    // --- HEADER CONFIGURATION ---

    // Add the CORS header to allow any domain to fetch this script.
    response.setHeader('Access-Control-Allow-Origin', '*');

    // Set the response content type
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');

    // Set cache headers based on the Vercel environment (best practice)
    if (VERCEL_ENV !== 'production') {
      // For any non-production environment (Preview, Development), do not cache.
      response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      console.log(`Cache disabled for non-production environment: "${VERCEL_ENV}"`);
    } else {
      // For the production environment, cache for 1 hour.
      response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      console.log(`Production cache set for environment: "${VERCEL_ENV}"`);
    }

    return response.status(200).send(finalScript);

  } catch (error) {
    console.error('An error occurred in the proxy loader:', error);
    // Also add CORS header to error responses so the browser can read them
    response.setHeader('Access-Control-Allow-Origin', '*');
    return response.status(500).send('// Server Error: Could not process the request.');
  }
}
