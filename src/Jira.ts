import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();

const server = new McpServer({
  name: "mcp-streamable-http",
  version: "1.0.0",
});

// ========== JOKE TOOLS ==========

const getChuckJoke = server.tool(
  "get-chuck-joke",
  "Get a random Chuck Norris joke",
  async () => {
    const response = await fetch("https://api.chucknorris.io/jokes/random");
    const data = await response.json();
    return {
      content: [{ type: "text", text: data.value }],
    };
  }
);

const getChuckJokeByCategory = server.tool(
  "get-chuck-joke-by-category",
  "Get a random Chuck Norris joke by category",
  {
    category: z.string().describe("Category of the Chuck Norris joke"),
  },
  async ({ category }) => {
    const response = await fetch(`https://api.chucknorris.io/jokes/random?category=${category}`);
    const data = await response.json();
    return {
      content: [{ type: "text", text: data.value }],
    };
  }
);

const getChuckCategories = server.tool(
  "get-chuck-categories",
  "Get all available categories for Chuck Norris jokes",
  async () => {
    const response = await fetch("https://api.chucknorris.io/jokes/categories");
    const data = await response.json();
    return {
      content: [{ type: "text", text: data.join(", ") }],
    };
  }
);

const getDadJoke = server.tool(
  "get-dad-joke",
  "Get a random dad joke",
  async () => {
    const response = await fetch("https://icanhazdadjoke.com/", {
      headers: { Accept: "application/json" },
    });
    const data = await response.json();
    return {
      content: [{ type: "text", text: data.joke }],
    };
  }
);

const getYoMommaJoke = server.tool(
  "get-yo-momma-joke",
  "Get a random Yo Momma joke and its category",
  async () => {
    const response = await fetch("https://www.yomama-jokes.com/api/v1/jokes/random/", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) throw new Error("Failed to fetch Yo Momma joke");

    const data = await response.json();
    return {
      content: [{ type: "text", text: `Category: ${data.category}\nJoke: ${data.joke}` }],
    };
  }
);

// ========== JIRA ISSUE RETRIEVAL TOOL ==========

const JIRA_DOMAIN = process.env.JIRA_DOMAIN!;
const JIRA_EMAIL = process.env.JIRA_EMAIL!;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN!;
const JIRA_AUTH = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

const getJiraIssues = server.tool(
  "get-jira-issues",
  "Retrieve Jira issues using filters like project, status, summary, label, assignee, or issueType",
  {
    project: z.string().describe("Jira project key (e.g., MCP)"),
    status: z.string().optional().describe("Issue status (e.g., Done, In Progress)"),
    summary: z.string().optional().describe("Text to match in summary"),
    label: z.string().optional().describe("Label to filter issues by (e.g., bug, urgent)"),
    assignee: z.string().optional().describe("User the issue is assigned to"),
    issueType: z.string().optional().describe("Type of issue (e.g., Task, Epic, Bug)"),
    limit: z.number().optional().describe("Max number of issues to retrieve"),
  },
  async ({ project, status, summary, label, assignee, issueType, limit }) => {
    const jqlParts = [];

    jqlParts.push(`project=${project}`);
    if (status) jqlParts.push(`status="${status}"`);
    if (summary) jqlParts.push(`summary~"${summary}"`);
    if (label) jqlParts.push(`labels="${label}"`);
    if (assignee) jqlParts.push(`assignee="${assignee}"`);
    if (issueType) jqlParts.push(`issuetype="${issueType}"`);

    const jql = jqlParts.join(" AND ");
    const maxResults = limit ?? 5;

    const url = `https://${JIRA_DOMAIN}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${JIRA_AUTH}`,
        "User-Agent": "mcp-jira-agent/1.0",

      },
    });

    if (!response.ok) {
      throw new Error(`Jira error: ${await response.text()}`);
    }

    const data = await response.json();
    const issues = data.issues.map((i: any) => `#${i.key}: ${i.fields.summary} [${i.fields.status.name}]`).join("\n");

    return {
      content: [{ type: "text", text: issues || "No matching issues found." }],
    };
  }
);



// ========== SERVICENOW INCIDENT TOOL ==========

const SN_INSTANCE = process.env.SN_INSTANCE!;
const SN_USERNAME = process.env.SN_USERNAME!;
const SN_PASSWORD = process.env.SN_PASSWORD!;
const basicAuth = Buffer.from(`${SN_USERNAME}:${SN_PASSWORD}`).toString("base64");

const getServiceNowIncidents = server.tool(
  "get-servicenow-incidents",
  "Retrieve ServiceNow incidents using filters like assigned_to, state, priority, or keywords",
  {
    assigned_to: z.string().optional().describe("User ID or name to filter by assigned user"),
    state: z.string().optional().describe("State of the incident (e.g., 1 for New, 2 for In Progress)"),
    priority: z.string().optional().describe("Priority level (1, 2, 3, etc.)"),
    short_description: z.string().optional().describe("Text to match in short description"),
    limit: z.number().optional().describe("Number of incidents to retrieve (default is 5)"),
  },
  async (params) => {
    const queryParts: string[] = [];

    if (params.assigned_to?.trim()) queryParts.push(`assigned_to=${params.assigned_to.trim()}`);
    if (params.state?.trim()) queryParts.push(`state=${params.state.trim()}`);
    if (params.priority?.trim()) queryParts.push(`priority=${params.priority.trim()}`);
    if (params.short_description?.trim()) queryParts.push(`short_descriptionLIKE${params.short_description.trim()}`);

    const sysparm_query = queryParts.join("^");
    const sysparm_limit = params.limit ?? 5;

    const url = `https://${SN_INSTANCE}.service-now.com/api/now/table/incident?sysparm_limit=${sysparm_limit}&sysparm_query=${encodeURIComponent(sysparm_query)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${basicAuth}`,
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`ServiceNow error: ${await response.text()}`);
    }

    const data = await response.json();
    const incidents = data.result.map((i: any) => `#${i.number}: ${i.short_description}`).join("\n");

    return {
      content: [{ type: "text", text: incidents || "No incidents found." }],
    };
  }
);

// ========== EXPRESS SERVER SETUP ==========

const app = express();
app.use(express.json());

const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless
});

const setupServer = async () => {
  await server.connect(transport);
};

app.post("/mcp", async (req: Request, res: Response) => {
  console.log("Received MCP request:", req.body);
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.get("/", (_req: Request, res: Response) => {
  res.send("✅ MCP Server is running. Use POST /mcp to interact.");
});

const PORT = process.env.PORT || 3000;
setupServer()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 MCP Streamable HTTP Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to set up the server:", err);
    process.exit(1);
  });
