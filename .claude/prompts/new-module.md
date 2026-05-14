# Prompt: Scaffold a new module

Use this prompt when creating a new business module.

## Context to include

- The module name and its primary entity types
- The workflow definition (states and transitions)
- Any cross-module relations needed

## Template prompt

"I'm creating the [MODULE_NAME] module. It has these entity types: [ENTITIES].
The primary workflow is: [STATES] with transitions [TRANSITIONS].
It needs these relations to other modules: [RELATIONS].

Please scaffold: Drizzle schema, entity type definitions, workflow config,
Hono routes, and a test file. Follow CLAUDE.md conventions exactly."
