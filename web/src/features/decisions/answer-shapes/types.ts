export type AnswerShape = "yes_no" | "choose_one" | "survey" | "edit" | "approve";

export interface DecisionPayload {
  contractVersion: "decision-request/v1";
  answerShape: AnswerShape;
  question: string;
  reason?: string | null;
  choices?: string[];
  cbaTable?: Array<Record<string, string>>;
}
