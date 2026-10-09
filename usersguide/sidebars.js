export default {
  guide: [
    'intro',
    {type: 'category', label: 'Start a project', items: [
      'getting-started/project-layout',
      'getting-started/first-call',
      'getting-started/local-development',
      'getting-started/deployment',
    ]},
    'existing-projects',
    {type: 'category', label: 'Add features', items: [
      'guides/notifications',
      'guides/authentication',
      'guides/mobile',
      'guides/custom-domain',
    ]},
    'examples',
    {type: 'category', label: 'Reference', items: [
      'reference/client',
      'reference/server',
      'reference/contracts',
      'reference/serverless',
      'reference/errors',
    ]},
    {type: 'category', label: 'Repository setup', items: ['repository/setup', 'repository/releases', 'repository/documentation']},
  ],
};
