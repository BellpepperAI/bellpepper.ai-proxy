// File: api/loader.js
// Vercel Serverless Function - v1.2 (Flexible ID Parsing)

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

async function getFileFromGitHub(path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const headers = { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3.raw' };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    if (response.status === 404) { return null; }
    throw new Error(`GitHub API request failed for path ${path}: ${response.statusText}`);
  }
  return response.text();
}

export default async function handler(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host}`);
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
      return response.status(400).send('Error: Customer ID could not be determined.');
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
      finalConfigContent = await getFileFromGitHub('configs/default.json');
      if (!finalConfigContent) {
        return response.status(404).send('Error: Default configuration could not be found.');
      }
    }

    if (!coreJsContent) {
        return response.status(500).send('Error: Core chatbot script could not be loaded.');
    }

    const finalScript = `window.ChatWidgetConfig = ${finalConfigContent};\n\n${coreJsContent}`;

    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    return response.status(200).send(finalScript);

  } catch (error) {
    console.error('An error occurred in the proxy loader:', error);
    return response.status(500).send('// Server Error: Could not process the request.');
  }
}
