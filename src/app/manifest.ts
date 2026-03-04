import type { MetadataRoute } from "next";

const ALIENA_LOGO =
  "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ΛLIΞNΛ",
    short_name: "ΛLIΞNΛ",
    description: "Enterprise AI Governance & Delivery Intelligence Platform",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0d14",
    theme_color: "#00B8DB",
    icons: [
      {
        src: ALIENA_LOGO,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: ALIENA_LOGO,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}