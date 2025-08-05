// File: api/loader.js

export const config = {
  runtime: 'edge',
};

// Helper function to fetch a file from your private GitHub repo
async function fetchFromGitHub(filePath, githubToken) {
  const apiUrl = `https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/contents/${filePath}`;
  
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github.v3.raw', // Fetches the raw file content directly
    },
    // Cache GitHub API responses for 60 seconds. This prevents hitting rate limits
    // during a burst of requests to uncached regions.
    next: { revalidate: 60 } 
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`File not found in repo: ${filePath}`);
    }
    throw new Error(`GitHub API Error for ${filePath}: ${response.status}`);
  }
  
  return response.text();
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  // Use the 'id' parameter from the URL, but fall back to 'default' if it's missing.
  let customerId = searchParams.get('id') || 'default';

  // Security: Sanitize the ID to ensure it only contains safe characters.
  if (!/^[a-zA-Z0-9_-]+$/.test(customerId)) {
    return new Response('// Error: Invalid customer ID format.', { status: 400 });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  // These paths match your desired structure in the 'bellpepper-ai-agents' repo.
  const configFilePath = `configs/customers/${customerId}.json`;
  const coreScriptPath = `configs/chatbot-core.js`;
  const defaultConfigPath = `configs/default.json`;

  try {
    // Fetch the core script and the config file at the same time for best performance.
    const [configJsonString, coreScriptContent] = await Promise.all([
      fetchFromGitHub(configFilePath, GITHUB_TOKEN).catch(err => {
        // If the customer-specific config isn't found, try to load the default one.
        console.warn(`Config for '${customerId}' not found, falling back to default.`);
        return fetchFromGitHub(defaultConfigPath, GITHUB_TOKEN);
      }),
      fetchFromGitHub(coreScriptPath, GITHUB_TOKEN)
    ]);

    // Assemble the final, personalized script.
    const finalScript = `window.ChatWidgetConfig = ${configJsonString};\n\n${coreScriptContent}`;

    // Set high-performance caching headers for Vercel's Edge Network and browsers.
    const headers = {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, max-age=300, stale-while-revalidate',
    };

    return new Response(finalScript, { status: 200, headers });

  } catch (error) {
    console.error(`Fatal error for customerId '${customerId}':`, error.message);
    return new Response('// Error: Could not build chatbot script.', { status: 500 });
  }
}
