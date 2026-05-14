import type { UserConfig } from '@commitlint/types';

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce scope from the list of known scopes
    'scope-enum': [
      2,
      'always',
      [
        // Packages
        'entity-engine',
        'workflow-engine',
        'automation-engine',
        'connector-sdk',
        'plugin-sdk',
        'auth',
        'notifications',
        'files',
        'audit',
        'ai',
        'db',
        'ui',
        'config',
        'logger',
        // Apps
        'api',
        'worker',
        'admin-ui',
        'portal',
        // Modules
        'crm',
        'helpdesk',
        'hrms',
        'reimbursements',
        'projects',
        'invoicing',
        'procurement',
        // Cross-cutting
        'deps',
        'ci',
        'docs',
        'dx',
        'security',
        'perf',
      ],
    ],
    'type-enum': [
      2,
      'always',
      [
        'feat',     // new feature
        'fix',      // bug fix
        'perf',     // performance improvement
        'refactor', // code change that neither fixes a bug nor adds a feature
        'test',     // adding or updating tests
        'docs',     // documentation only
        'chore',    // build process, dependency updates, tooling
        'ci',       // CI/CD changes
        'revert',   // revert a previous commit
        'security', // security fix or improvement
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 150],
  },
};

export default config;
