import { Injectable } from '@nestjs/common';

@Injectable()
export class AiService {
  private readonly questions = [
    "Certainly. I've synthesized a Project Draft for the \"Marketing Rebrand\". I've included phases for Research, Creative Direction, and Asset Production.",
    "That sounds good. I've updated the timeline to 14 weeks. Would you like to review the milestones?",
    "Great. I've scheduled the kickoff for next Monday. Anything else?"
  ];

  getInitialQuestion() {
    return {
      message: "Hello. I'm ready to help you coordinate your upcoming sprints. How would you like to proceed with the Q4 initiatives?",
      nextQuestionIndex: 0
    };
  }

  handleUserReply(index: number, reply: string) {
    if (index < this.questions.length) {
      return {
        message: this.questions[index],
        nextQuestionIndex: index + 1
      };
    }
    return {
      message: "I've handled your request. Is there anything else I can help with?",
      nextQuestionIndex: -1
    };
  }
}
