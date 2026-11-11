export type UserPreferences = {
  about: string;
  instructions: string;
  tone: "balanced" | "direct" | "creative";
  historyEnabled: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  about: "", instructions: "", tone: "balanced", historyEnabled: true,
};
