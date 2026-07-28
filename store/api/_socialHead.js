import {
  escapeHtmlAttribute,
  escapeHtmlText,
  isApprovedStoreSocialMetadata,
} from './_socialMetadata.js';

function attributeTag(attribute, key, value) {
  return `<meta ${attribute}="${escapeHtmlAttribute(key)}" content="${escapeHtmlAttribute(value)}">`;
}

export function renderSocialHead(metadata) {
  if (!isApprovedStoreSocialMetadata(metadata)) {
    throw new TypeError('Store social metadata must come from an approved constructor.');
  }

  const lines = [
    `<title>${escapeHtmlText(metadata.title)}</title>`,
    attributeTag('name', 'description', metadata.description),
  ];

  if (metadata.canonicalUrl) {
    lines.push(`<link rel="canonical" href="${escapeHtmlAttribute(metadata.canonicalUrl)}">`);
  }

  lines.push(
    attributeTag('property', 'og:type', metadata.openGraph.type),
    attributeTag('property', 'og:title', metadata.openGraph.title),
    attributeTag('property', 'og:description', metadata.openGraph.description),
  );

  if (metadata.openGraph.url) {
    lines.push(attributeTag('property', 'og:url', metadata.openGraph.url));
  }
  if (metadata.openGraph.image) {
    lines.push(
      attributeTag('property', 'og:image', metadata.openGraph.image),
      attributeTag('property', 'og:image:type', metadata.openGraph.imageType),
      attributeTag('property', 'og:image:width', String(metadata.openGraph.imageWidth)),
      attributeTag('property', 'og:image:height', String(metadata.openGraph.imageHeight)),
      attributeTag('property', 'og:image:alt', metadata.openGraph.imageAlt),
    );
  }

  lines.push(
    attributeTag('property', 'og:locale', metadata.openGraph.locale),
    attributeTag('property', 'og:site_name', metadata.openGraph.siteName),
    attributeTag('name', 'twitter:card', metadata.twitter.card),
    attributeTag('name', 'twitter:title', metadata.twitter.title),
    attributeTag('name', 'twitter:description', metadata.twitter.description),
  );

  if (metadata.twitter.image) {
    lines.push(
      attributeTag('name', 'twitter:image', metadata.twitter.image),
      attributeTag('name', 'twitter:image:alt', metadata.twitter.imageAlt),
    );
  }

  return lines.join('\n');
}
