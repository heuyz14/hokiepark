/** Recognize explicit references to the user's position; ordinary map questions do not send coordinates. */
export function requestsCurrentLocation(question: string): boolean {
  const text = question.toLowerCase().replaceAll('’', "'");
  return /\b(current location|my location|where i am|where i'm|from here|near me|my position|my gps|see myself on (?:the )?map|blue dot)\b/.test(text);
}
