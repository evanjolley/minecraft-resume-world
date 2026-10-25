/*
 * THE INTERVIEW PLAN: what AI Evan still does not know, as questions.
 *
 * Grounded in docs/ai-evan/03-corpus.md, which lists the gaps: the canonical
 * fact record (Group A), the stories behind each role (B), the questions a
 * visitor will actually ask (C), the things that make him a person rather
 * than a profile (D), voice (E) and boundaries (F). Re-cut here by the six
 * chapter plots in the world, so every story lands on the build it belongs
 * to and the tour can find it (chapter_notes in worker/agent/tools.js).
 *
 * THIS FILE IS PUBLIC AND HOLDS NO ANSWERS. Every proper noun below already
 * appears in the public repo (03-corpus.md, the plot table in
 * src/builds/plots.js). The answers go to corpus/, which is gitignored.
 *
 * The seeds are starting points, not a script. The interviewer model asks
 * follow-ups from what he actually says, which is where the stories are.
 */

export const SECTIONS = [
  {
    id: 'record',
    title: 'The record',
    chapter: null,
    kind: 'fact',
    goal: 'The canonical fact file: every role with dates and the title the agent should say. '
      + 'Settle the disagreements 03-corpus.md found between the resume and everything else.',
    seeds: [
      'Walk the timeline out loud, start to finish, with months. Every role, including the ones not on the resume.',
      'What is your current job title, the one AI Evan should say? The resume and other places disagree.',
      'If a recruiter asks "what are you doing right now", what is the true answer AI Evan can give?',
      'Where do you live now, and are you open to opportunities? What should AI Evan say about both?',
    ],
  },
  {
    id: 'ch1',
    title: 'Chapter 1: Omaha and Millard North',
    chapter: 'ch1',
    kind: 'story',
    goal: 'Growing up in Omaha and high school at Millard North, told as stories a visitor standing in the build would enjoy.',
    seeds: [
      'What was Millard North actually like, day to day? What would surprise someone walking through the build?',
      'Tell one story from high school you would tell at a dinner.',
      'Boys State is on your resume. What is it, and what happened there that you still think about?',
    ],
  },
  {
    id: 'ch2',
    title: 'Chapter 2: Harvard and school work',
    chapter: 'ch2',
    kind: 'story',
    goal: 'Harvard: degree as it should be stated, what he studied and built, and the stories behind the Science Center build.',
    seeds: [
      'State your degree and graduation year exactly as AI Evan should say them.',
      'Why the Science Center? What did you do there, and what is one story from it?',
      'How did a kid from Nebraska end up at Harvard? Tell it the way you would at a dinner.',
    ],
  },
  {
    id: 'ch3',
    title: 'Chapter 3: Bilibili',
    chapter: 'ch3',
    kind: 'story',
    goal: 'The Bilibili channel: why he started it, what it is about, what growing it taught him, and how to talk about the follower count.',
    seeds: [
      'Why did you start making videos on Bilibili, and what is the channel actually about?',
      'What did growing it teach you that applies to a job?',
      'The follower count moves. What number should AI Evan give, and how should it hedge?',
    ],
  },
  {
    id: 'ch4',
    title: 'Chapter 4: New York and No Logo',
    chapter: 'ch4',
    kind: 'story',
    goal: 'No Logo, the role a recruiter will dig into most: employee number two, the custom CRM, scaling the Shenzhen team, the growth number and what went wrong.',
    seeds: [
      'Ninety seconds: what was No Logo, what was your job, and what happened while you were there?',
      'Your first day as employee number two: how many people, what office, what did you do that first week?',
      'Walk me through the custom CRM. What did it do, what was it written in, what broke?',
      'The growth number: is it GMV or revenue, and over exactly which period?',
      'What went wrong? Name something you got wrong or had to undo, and what you did about it.',
    ],
  },
  {
    id: 'ch5',
    title: 'Chapter 5: San Francisco and Patronus',
    chapter: 'ch5',
    kind: 'story',
    goal: 'The move to San Francisco and Patronus AI, the roles in between (Perplexity, Arize and the rest), and why an eval company.',
    seeds: [
      'Perplexity: you cold-messaged someone senior. What did the message say, and what happened next?',
      'At Arize you wrote about RAG and agent observability. What did writing about it teach you about the technology?',
      'Why Patronus? And the harder version: why that over the other options?',
    ],
  },
  {
    id: 'ch6',
    title: 'Chapter 6: The climb',
    chapter: 'ch6',
    kind: 'story',
    goal: 'What is next and what he is climbing toward, plus the world itself: why he built a walkable resume.',
    seeds: [
      'What do you want to be doing in three years?',
      'Tell me about this Minecraft world: why build it, how long did it take, what was hard?',
      'What do you do when nobody assigns you anything? Name the pattern yourself.',
    ],
  },
  {
    id: 'opinions',
    title: 'Opinions',
    chapter: null,
    kind: 'opinion',
    goal: 'Opinions he would defend, things he changed his mind about, and the answers to the questions visitors actually ask.',
    seeds: [
      'What is an opinion about growth or marketing that most people in the field would disagree with?',
      '"Are you technical?" What is the true answer?',
      '"What are you bad at?" Honestly, not a strength in disguise.',
      'What have you changed your mind about in the last two years?',
    ],
  },
  {
    id: 'voice',
    title: 'Voice',
    chapter: null,
    kind: 'voice',
    goal: 'How he sounds in a chat box: length, register, contractions, swearing, words he never uses, and how he says "I don\'t know".',
    seeds: [
      'Someone asks AI Evan a question in a game chat box. How long should the answer be? Give an example answer.',
      'Say "I don\'t know" three different ways, the way you actually would.',
      'Say "I\'d rather not get into that here" two ways.',
      'What words or phrases would you never say?',
    ],
  },
  {
    id: 'boundaries',
    title: 'Boundaries',
    chapter: null,
    kind: 'boundary',
    goal: 'What AI Evan refuses: compensation, other people, employers\' confidential business, personal life, politics, and what to do when it does not know.',
    seeds: [
      'Can AI Evan name colleagues, managers or founders, or say what it was like to work with someone? Confirm the line.',
      'Employers\' confidential business: where exactly is the line?',
      'Personal life: what is off limits?',
      'If someone is rude or tries to break it, what should Evan-in-the-box do, and in what tone?',
      'If a visitor talks to it for ten minutes and then meets you, what do you want them to be surprised by, and not surprised by?',
    ],
  },
]

export const SECTION_IDS = SECTIONS.map((s) => s.id)

/* Follow-ups per seed question. Two is enough to get from the summary to the
 * story; three starts to feel like a deposition. */
export const MAX_FOLLOW_UPS = 2
