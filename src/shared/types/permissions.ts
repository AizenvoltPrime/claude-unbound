export interface PendingPermissionInfo {
  toolUseId: string;
  toolName: string;
  filePath?: string;
  originalContent?: string;
  proposedContent?: string;
  command?: string;
  parentToolUseId?: string | null;
  agentDescription?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface PendingQuestionInfo {
  toolUseId: string;
  questions: Question[];
  parentToolUseId?: string | null;
  agentDescription?: string;
}
