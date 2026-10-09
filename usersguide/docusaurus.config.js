import {themes} from 'prism-react-renderer';

export default {
  title: 'aws-classify',
  tagline: 'Call a class method. Let your client and AWS do the rest.',
  url: 'https://selsamman.github.io',
  baseUrl: '/aws-classify/',
  trailingSlash: true,
  favicon: 'img/logo.svg',
  organizationName: 'selsamman',
  projectName: 'aws-classify',
  deploymentBranch: 'gh-pages',
  onBrokenLinks: 'throw',
  markdown: {hooks: {onBrokenMarkdownLinks: 'throw'}},
  i18n: {defaultLocale: 'en', locales: ['en']},
  presets: [['classic', {
    docs: {
      path: 'content',
      routeBasePath: '/',
      sidebarPath: './sidebars.js',
      editUrl: 'https://github.com/selsamman/aws-classify/edit/master/usersguide/',
      showLastUpdateAuthor: false,
      showLastUpdateTime: false,
    },
    blog: false,
    theme: {customCss: './src/css/custom.css'},
  }]],
  themeConfig: {
    colorMode: {defaultMode: 'light', respectPrefersColorScheme: true},
    navbar: {
      title: 'aws-classify',
      logo: {alt: 'aws-classify', src: 'img/logo.svg'},
      items: [
        {type: 'doc', docId: 'getting-started/project-layout', label: 'Get started', position: 'left'},
        {type: 'doc', docId: 'existing-projects', label: 'Existing project', position: 'left'},
        {type: 'doc', docId: 'reference/client', label: 'Reference', position: 'left'},
        {href: 'https://github.com/selsamman/aws-classify', label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {title: 'Build something', items: [
          {label: 'Start a project', to: '/getting-started/project-layout'},
          {label: 'Add to your project', to: '/existing-projects'},
          {label: 'Sample applications', to: '/examples'},
        ]},
        {title: 'Go further', items: [
          {label: 'API reference', to: '/reference/client'},
          {label: 'Work on the repository', to: '/repository/setup'},
          {label: 'Implementation docs', href: 'https://github.com/selsamman/aws-classify/tree/master/docs'},
        ]},
      ],
      copyright: 'aws-classify · Open source under the MIT license',
    },
    prism: {theme: themes.github, darkTheme: themes.dracula, additionalLanguages: ['bash', 'json', 'yaml', 'typescript']},
  },
};
