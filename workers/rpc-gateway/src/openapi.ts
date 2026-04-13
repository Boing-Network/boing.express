/** Minimal OpenAPI 3.1 for partner docs; POST body matches Boing JSON-RPC over HTTP. */
export const OPENAPI_GATEWAY_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'Boing Express — JSON-RPC gateway',
    description:
      'HTTP proxy for selected read-only Boing JSON-RPC methods (DEX discovery, health, chain metadata). ' +
      'Same request/response contract as the upstream Boing node. See Boing Network docs/RPC-API-SPEC.md.',
    version: '0.1.0',
  },
  paths: {
    '/v1/rpc': {
      post: {
        operationId: 'boingJsonRpc',
        summary: 'Boing JSON-RPC (allowlisted methods)',
        description:
          'Forwards the JSON body unchanged to the configured upstream RPC URL after method allowlisting. ' +
          'Supports a single JSON-RPC object or a JSON-RPC batch array. ' +
          'Optional auth: set gateway secret `GATEWAY_API_KEY`, then send `Authorization: Bearer <key>` or `X-Boing-Gateway-Key: <key>`.',
        parameters: [
          {
            name: 'Authorization',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Bearer token when `GATEWAY_API_KEY` is configured.',
          },
          {
            name: 'X-Boing-Gateway-Key',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Alternative to Authorization when `GATEWAY_API_KEY` is configured.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['jsonrpc', 'method'],
                    properties: {
                      jsonrpc: { const: '2.0' },
                      id: { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
                      method: { type: 'string', example: 'boing_listDexPools' },
                      params: {},
                    },
                  },
                  {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['jsonrpc', 'method'],
                      properties: {
                        jsonrpc: { const: '2.0' },
                        method: { type: 'string' },
                        params: {},
                      },
                    },
                  },
                ],
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'JSON-RPC result or error object (same as upstream; batch returns array). May include `X-Gateway-Cache: HIT` | `MISS` when response caching is enabled.',
            headers: {
              'X-Gateway-Cache': {
                schema: { type: 'string', enum: ['HIT', 'MISS'] },
                description: 'Present when `GATEWAY_CACHE_TTL_SECONDS` > 0.',
              },
            },
            content: {
              'application/json': {
                schema: {},
              },
            },
          },
          '400': { description: 'Invalid JSON body' },
          '401': { description: 'Missing or invalid API key when gateway auth is enabled' },
          '403': { description: 'JSON-RPC method not on gateway allowlist' },
          '502': { description: 'Upstream RPC unreachable or non-2xx' },
        },
      },
    },
  },
} as const;
