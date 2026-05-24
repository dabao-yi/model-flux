export const WEB_FETCH_TOOL = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch content from a URL over HTTP/HTTPS. Use this when you need to retrieve content from a web URL. Returns HTTP status and response body, with HTML pages converted to clean markdown. Supports all HTTP methods.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (http:// or https://)" },
        method: {
          type: "string",
          enum: ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
          description: "HTTP method (default: GET)",
        },
        headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },
        body: { type: "string", description: "Request body for POST/PUT/PATCH requests" },
      },
      required: ["url"],
    },
  },
} as const;
