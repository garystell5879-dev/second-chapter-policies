// The 20-question compatibility questionnaire.
// Each answer is stored by question id (q1..q20) and option id (a, b, c...).
// Edit wording freely; changing ids would orphan answers already saved.
window.SC_QUESTIONS = [
  { id: "q1", text: "What are you hoping to find?", options: [
    ["a", "A long-term partner"], ["b", "Companionship"], ["c", "Friendship first, then see"], ["d", "I'm not sure yet"] ] },
  { id: "q2", text: "How do you feel about marriage?", options: [
    ["a", "I'd like to marry (again)"], ["b", "Open to it with the right person"], ["c", "I'd rather not marry"], ["d", "Undecided"] ] },
  { id: "q3", text: "Which describes your children?", options: [
    ["a", "Kids still living at home"], ["b", "Grown kids"], ["c", "No children"] ] },
  { id: "q4", text: "Would you date someone with kids still at home?", options: [
    ["a", "Yes"], ["b", "Prefer their kids are grown"], ["c", "No"] ] },
  { id: "q5", text: "How important is faith in your life?", options: [
    ["a", "Very important"], ["b", "Somewhat important"], ["c", "Not very important"], ["d", "Not at all"] ] },
  { id: "q6", text: "Should a partner share your faith?", options: [
    ["a", "Yes, that matters to me"], ["b", "Nice, but not required"], ["c", "Doesn't matter"] ] },
  { id: "q7", text: "Your ideal weekend looks like…", options: [
    ["a", "Quiet time at home"], ["b", "Out with friends and family"], ["c", "Outdoors"], ["d", "A trip somewhere new"] ] },
  { id: "q8", text: "How social are you?", options: [
    ["a", "Homebody"], ["b", "A healthy balance"], ["c", "Love being around people"] ] },
  { id: "q9", text: "Are you an early bird or a night owl?", options: [
    ["a", "Early bird"], ["b", "Somewhere in between"], ["c", "Night owl"] ] },
  { id: "q10", text: "How do you feel about smoking?", options: [
    ["a", "I don't smoke and prefer a non-smoker"], ["b", "I don't smoke, but don't mind it"], ["c", "I smoke"] ] },
  { id: "q11", text: "How often do you drink alcohol?", options: [
    ["a", "Never"], ["b", "Socially"], ["c", "Regularly"] ] },
  { id: "q12", text: "Pets?", options: [
    ["a", "I have pets and love them"], ["b", "I like pets"], ["c", "I'd rather not have pets"], ["d", "I'm allergic"] ] },
  { id: "q13", text: "When there's a disagreement, you…", options: [
    ["a", "Talk it through right away"], ["b", "Cool off, then talk"], ["c", "Tend to let it go"] ] },
  { id: "q14", text: "How affectionate are you?", options: [
    ["a", "Very affectionate"], ["b", "Warm but reserved"], ["c", "Fairly private"] ] },
  { id: "q15", text: "With money, you're more of a…", options: [
    ["a", "Saver"], ["b", "Balance of both"], ["c", "Spender"] ] },
  { id: "q16", text: "How often would you like to hear from a partner?", options: [
    ["a", "Several times a day"], ["b", "Once a day"], ["c", "A few times a week"] ] },
  { id: "q17", text: "Where do you see yourself living?", options: [
    ["a", "Staying where I am"], ["b", "Open to moving"], ["c", "Keeping separate homes"] ] },
  { id: "q18", text: "How much do political views matter in a partner?", options: [
    ["a", "We need to agree"], ["b", "Similar is better"], ["c", "Doesn't matter"] ] },
  { id: "q19", text: "Your activity level is…", options: [
    ["a", "Very active"], ["b", "Moderately active"], ["c", "A relaxed pace"] ] },
  { id: "q20", text: "You feel most loved through…", options: [
    ["a", "Kind words"], ["b", "Quality time"], ["c", "Physical affection"], ["d", "Helpful acts"], ["e", "Thoughtful gifts"] ] }
];

// Tulsa launch area first; anyone else picks "Somewhere else" and types a city.
window.SC_LOCATIONS = [
  "Tulsa", "Broken Arrow", "Owasso", "Bixby", "Jenks", "Sand Springs", "Sapulpa",
  "Glenpool", "Coweta", "Claremore", "Collinsville", "Skiatook", "Catoosa",
  "Sperry", "Mounds", "Kiefer", "Haskell", "Wagoner", "Verdigris", "Inola",
  "Chelsea", "Pryor", "Okmulgee", "Bristow", "Kellyville", "Oologah",
  "Hominy", "Pawhuska", "Muskogee"
];
