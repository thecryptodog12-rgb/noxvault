import type { Metadata } from "next";

const SITE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Noxvault: the safer, quantum-proof wallet for Solana" };

/**
 * Title + description, repeated into Open Graph and the X card. A page's openGraph/twitter
 * replaces the parent's, including the root opengraph-image, so the site image is added back
 * here. Pass `siteImage: false` for a segment with its own opengraph-image file.
 */
export function pageMeta(title: string, description: string, { siteImage = true } = {}): Metadata {
  const images = siteImage ? [SITE_IMAGE] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Noxvault", type: "website", ...(images && { images }) },
    twitter: { card: "summary_large_image", site: "@noxvaultHQ", creator: "@noxvaultHQ", title, description, ...(images && { images }) },
  };
}
