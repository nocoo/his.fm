export function buildRobotsTxt(origin: string) {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /login
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}
