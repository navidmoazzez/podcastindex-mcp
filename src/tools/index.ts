/** Every tool, in the order they should appear in a client's tool list. */

import { STATUS_TOOLS } from "./status.js";
import { SEARCH_TOOLS } from "./search.js";
import { PODCAST_TOOLS } from "./podcasts.js";
import { EPISODE_TOOLS } from "./episodes.js";
import { CONTENT_TOOLS } from "./content.js";
import { DISCOVERY_TOOLS } from "./discovery.js";
import { VALUE_TOOLS } from "./value.js";
import { HEALTH_TOOLS } from "./health.js";
import { RESEARCH_TOOLS } from "./research.js";
import { WRITE_TOOLS } from "./write.js";
import type { AnyToolSpec } from "./kit.js";

export const ALL_TOOLS = [
  ...STATUS_TOOLS,
  ...SEARCH_TOOLS,
  ...PODCAST_TOOLS,
  ...EPISODE_TOOLS,
  ...CONTENT_TOOLS,
  ...RESEARCH_TOOLS,
  ...DISCOVERY_TOOLS,
  ...VALUE_TOOLS,
  ...HEALTH_TOOLS,
  ...WRITE_TOOLS,
] as unknown as AnyToolSpec[];
