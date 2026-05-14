# Prompt: Scaffold a Hono route

## Template prompt
"Add a [METHOD] /[path] route to apps/api. It should:
- Require auth
- Require role: [ROLES]
- Validate input with Zod schema: [SCHEMA DESCRIPTION]
- Call: [SERVICE/ENGINE FUNCTION]
- Return: [RESPONSE SHAPE]

Include the route handler, the Zod schema, and a test file."
