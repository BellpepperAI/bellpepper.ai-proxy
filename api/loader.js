// File: api/loader.js
// Vercel Serverless Function - v1.1 (Robust Parsing)

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// Helper function to fetch file content from the private GitHub repository
async function getFileFromGitHub(path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3.raw',
  };
  
  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`GitHub API request failed for path ${path}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// The main serverless function handler
export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host}`);
    let customerId = url.pathname.slice(1);

    // --- FIX: Sanitize the customerId ---
    if (customerId) {
        // 1. Remove trailing slash if it exists
        if (customerId.endsWith('/')) {
          customerId = customerId.slice(0, -1);
        }
        // 2. Remove .js extension if it exists
        if (customerId.endsWith('.js')) {
          customerId = customerId.slice(0, -3);
        }
    }
    // --- END FIX ---

    if (!customerId) {
      return response.status(400).send('Error: Customer ID is missing or invalid in the request URL.');
    }

    const coreScriptPath = 'configs/chatbot-core.js';
    let customerConfigPath = `configs/customers/${customerId}.json`;

    const [coreJsContent, customerJsonContent] = await Promise.all([
      getFileFromGitHub(coreScriptPath),
      getFileFromGitHub(customerConfigPath)
    ]);

    let finalConfigContent = customerJsonContent;
    if (!finalConfigContent) {
      console.warn(`Config for customer "${customerId}" not found. Falling back to default.`);
      const defaultConfigPath = 'configs/default.json';
      finalConfigContent = await getFileFromGitHub(defaultConfigPath);
      if (!finalConfigContent) {
        return response.status(404).send('Error: Default configuration not found.');
      }
    }
    
    if (!coreJsContent) {
        return response.status(500).send('Error: Core chatbot script could not be loaded.');
    }

    const finalScript = `window.ChatWidgetConfig = ${finalConfigContent};\n\n${coreJsContent}`;

    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return response.status(200).send(finalScript);

  } catch (error)
  {
    console.error('An error occurred in the proxy loader:', error);
    return response.status(500).send('// Server Error: Could not process the request.');
  }
}
