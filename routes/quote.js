'use strict';
// QUOTE OF THE DAY: one well-known quotation, the same for everyone in every firm, changing at midnight India time (so it stays for 24 hours).
const L = require('../lib');
const QUOTES = [
  ['Injustice anywhere is a threat to justice everywhere.', 'Martin Luther King Jr.'], ['Justice delayed is justice denied.', 'William E. Gladstone'], ['The law is reason free from passion.', 'Aristotle'],
  ['Where there is no law, there is no freedom.', 'John Locke'], ['It always seems impossible until it is done.', 'Nelson Mandela'], ['Education is the most powerful weapon which you can use to change the world.', 'Nelson Mandela'],
  ['Arise, awake, and stop not till the goal is reached.', 'Swami Vivekananda'], ['Dream is not that which you see while sleeping, it is something that does not let you sleep.', 'A. P. J. Abdul Kalam'],
  ['If you want to shine like a sun, first burn like a sun.', 'A. P. J. Abdul Kalam'], ['Excellence is not an act but a habit.', 'Will Durant'], ['Nothing in this world can take the place of persistence.', 'Calvin Coolidge'],
  ['The life of the law has not been logic; it has been experience.', 'Oliver Wendell Holmes Jr.'], ['The law must be stable, but it must not stand still.', 'Roscoe Pound'], ['Truth alone triumphs.', 'Mundaka Upanishad'],
  ['The Constitution is not a mere lawyers’ document; it is a vehicle of life.', 'B. R. Ambedkar'], ['Cultivation of mind should be the ultimate aim of human existence.', 'B. R. Ambedkar'],
  ['Justice is the constant and perpetual will to allot to every man his due.', 'Justinian'], ['The good of the people is the highest law.', 'Cicero'], ['Law is the public conscience.', 'Thomas Hobbes'],
  ['Discourage litigation. Persuade your neighbors to compromise whenever you can.', 'Abraham Lincoln'], ['Honesty is the first chapter in the book of wisdom.', 'Thomas Jefferson'],
  ['The arc of the moral universe is long, but it bends toward justice.', 'Martin Luther King Jr.'], ['Let us never negotiate out of fear. But let us never fear to negotiate.', 'John F. Kennedy'],
  ['Never doubt that a small group of thoughtful, committed citizens can change the world.', 'Margaret Mead'], ['Time is what we want most, but what we use worst.', 'William Penn'],
  ['Small deeds done are better than great deeds planned.', 'Peter Marshall'], ['Well done is better than well said.', 'Benjamin Franklin'], ['An investment in knowledge pays the best interest.', 'Benjamin Franklin'],
  ['Lost time is never found again.', 'Benjamin Franklin'], ['Act as if what you do makes a difference. It does.', 'William James'], ['Genius is one percent inspiration and ninety-nine percent perspiration.', 'Thomas Edison'],
  ['Strive not to be a success, but rather to be of value.', 'Albert Einstein'], ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'], ['Courage is grace under pressure.', 'Ernest Hemingway'],
  ['Whether you think you can, or you think you can’t, you’re right.', 'Henry Ford'], ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'], ['Doubt is not a pleasant condition, but certainty is absurd.', 'Voltaire'],
  ['The quality of mercy is not strained.', 'William Shakespeare'], ['Dharma protects those who protect it.', 'Manusmriti'], ['Punctuality is the soul of business.', 'Thomas C. Haliburton'],
  ['The expert in anything was once a beginner.', 'Helen Hayes'], ['Be less curious about people and more curious about ideas.', 'Marie Curie'], ['Strength does not come from physical capacity. It comes from an indomitable will.', 'Mahatma Gandhi'],
  ['Words are, of course, the most powerful drug used by mankind.', 'Rudyard Kipling'], ['Liberty lies in the hearts of men and women.', 'Learned Hand'], ['Law and order are the medicine of the body politic.', 'B. R. Ambedkar'],
  ['A lawyer’s time and advice are his stock in trade.', 'Abraham Lincoln'], ['Fall seven times, stand up eight.', 'Japanese proverb'],
];
const dayNo = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
const quoteFor = (date) => { const q = QUOTES[((dayNo(date) % QUOTES.length) + QUOTES.length) % QUOTES.length]; return { date, text: q[0], by: q[1] }; };
module.exports = (app) => {
  app.get('/api/quote', L.requireLogin, (req, res) => { const date = new Date(Date.now() + 19800000).toISOString().slice(0, 10); res.set('Cache-Control', 'private, max-age=600'); res.json(quoteFor(date)); });
};
Object.assign(module.exports, { QUOTES, quoteFor });
