// Barrel for the provider-agnostic AI content architecture. Import from
// "@/server/ai" rather than reaching into individual files.

export * from "./types";
export * from "./mock-provider";
export * from "./openai-provider";
export * from "./get-ai-provider";
export * from "./log-generation";
export * from "./prompt-helpers";

export * from "./services/matchup-preview";
export * from "./services/matchup-recap";
export * from "./services/weekly-summary";
export * from "./services/power-rankings";
export * from "./services/manager-profile";
export * from "./services/season-summary";
export * from "./services/trade-retrospective";
export * from "./services/weekly-awards";
export * from "./services/quote-selection";
export * from "./services/manager-communication-profile";
export * from "./services/relationship-summary";
export * from "./services/league-communication-profile";
export * from "./content-memory";
export * from "./research-packet";
