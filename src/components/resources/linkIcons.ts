import { BookOpen, Briefcase, Building, Link2, Server, Wrench, type LucideIcon } from "lucide-react";
import type { ResourceLinkCategory } from "@/types";

/** One icon per link category — shared by the Resources page and the dashboard's Quick links. */
export const LINK_CATEGORY_ICON: Record<ResourceLinkCategory, LucideIcon> = {
  company: Building,
  tool: Wrench,
  system: Server,
  docs: BookOpen,
  client: Briefcase,
  other: Link2,
};
