export type UserPreferences = {
  about: string;
  instructions: string;
  tone: "balanced" | "direct" | "creative" | "rough";
  historyEnabled: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  about: "", instructions: "", tone: "balanced", historyEnabled: true,
};
