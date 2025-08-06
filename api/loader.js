// File: api/loader.js
// Vercel Serverless Function to securely assemble and serve the agent script.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// Helper function to fetch file content from the private GitHub repository
async function getFileFromGitHub(path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3.raw', // Important: gets the raw file content
  };
  
  const response = await fetch(url, { headers });

  if (!response.ok) {
    // If the file is not found, return null to handle fallback logic
    if (response.status === 404) {
      return null;
    }
    // For other errors, throw an exception
    throw new Error(`GitHub API request failed for path ${path}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// The main serverless function handler
export default async function handler(request, response) {
  try {
    // Extract customer ID from the URL path (e.g., /customer-a -> customer-a)
    const url = new URL(request.url, `https://${request.headers.host}`);
    const customerId = url.pathname.slice(1);

    if (!customerId) {
      return response.status(400).send('Error: Customer ID is missing in the request URL.');
    }

    // Define paths to the files in the private repository
    const coreScriptPath = 'configs/chatbot-core.js';
    let customerConfigPath = `configs/customers/${customerId}.json`;

    // Fetch the core script and customer config in parallel for performance
    const [coreJsContent, customerJsonContent] = await Promise.all([
      getFileFromGitHub(coreScriptPath),
      getFileFromGitHub(customerConfigPath)
    ]);

    // Handle fallback to default config if customer-specific config is not found
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

    // Assemble the final script
    // 1. Create the window.ChatWidgetConfig object from the JSON content.
    // 2. Append the core chatbot engine script.
    const finalScript = `window.ChatWidgetConfig = ${finalConfigContent};\n\n${coreJsContent}`;

    // Set response headers for JavaScript content and Vercel Edge Caching
    response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // 1 hour CDN cache

    // Send the assembled script as the response
    return response.status(200).send(finalScript);

  } catch (error) {
    console.error('An error occurred in the proxy loader:', error);
    return response.status(500).send('// Server Error: Could not process the request.');
  }
}
