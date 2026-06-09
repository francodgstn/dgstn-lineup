export interface Quote {
  text: string
  author: string
}

export const QUOTES: Quote[] = [
  { text: "Champions aren't made in gyms. Champions are made from something deep inside them — a desire, a dream, a vision.", author: 'Muhammad Ali' },
  { text: "The more difficult the victory, the greater the happiness in winning.", author: 'Pelé' },
  { text: "Hard work beats talent when talent doesn't work hard.", author: 'Tim Notke' },
  { text: "Do not let what you cannot do interfere with what you can do.", author: 'John Wooden' },
  { text: "It's not whether you get knocked down; it's whether you get up.", author: 'Vince Lombardi' },
  { text: "If you fail to prepare, you're prepared to fail.", author: 'Mark Spitz' },
  { text: "Pain is temporary. Quitting lasts forever.", author: 'Lance Armstrong' },
  { text: "A champion is afraid of losing. Everyone else is afraid of winning.", author: 'Billie Jean King' },
  { text: "Make each day your masterpiece.", author: 'John Wooden' },
  { text: "The more I practice, the luckier I get.", author: 'Gary Player' },
  { text: "Gold medals aren't really made of gold. They're made of sweat, determination, and guts.", author: 'Dan Gable' },
  { text: "Talent wins games, but teamwork and intelligence win championships.", author: 'Michael Jordan' },
  { text: "Never let the fear of striking out keep you from playing the game.", author: 'Babe Ruth' },
  { text: "It ain't over till it's over.", author: 'Yogi Berra' },
  { text: "One man can be a crucial ingredient on a team, but one man cannot make a team.", author: 'Kareem Abdul-Jabbar' },
  { text: "I can accept failure — everyone fails at something. But I can't accept not trying.", author: 'Michael Jordan' },
  { text: "Champions keep playing until they get it right.", author: 'Billie Jean King' },
  { text: "Discipline is the bridge between goals and accomplishment.", author: 'Jim Rohn' },
  { text: "Today I will do what others won't, so tomorrow I can do what others can't.", author: 'Jerry Rice' },
  { text: "The secret is to work less as individuals and more as a team.", author: 'Knute Rockne' },
  { text: "Float like a butterfly, sting like a bee.", author: 'Muhammad Ali' },
  { text: "Winning isn't everything, but wanting to win is.", author: 'Vince Lombardi' },
  { text: "Ability is what you're capable of doing. Motivation determines what you do. Attitude determines how well you do it.", author: 'Lou Holtz' },
  { text: "The difference between the impossible and the possible lies in determination.", author: 'Tommy Lasorda' },
  { text: "Excellence is not a singular act but a habit.", author: 'Shaquille O\'Neal' },
  { text: "You miss 100% of the shots you don't take.", author: 'Wayne Gretzky' },
  { text: "Victory is in having done your best. If you've done your best, you've won.", author: 'Billy Bowerman' },
  { text: "The only way to prove you're a good sport is to lose.", author: 'Ernie Banks' },
  { text: "Without self-discipline, success is impossible, period.", author: 'Lou Holtz' },
  { text: "I hated every minute of training, but I said: don't quit. Suffer now and live the rest of your life as a champion.", author: 'Muhammad Ali' },
  { text: "Don't measure yourself by what you have accomplished, but by what you should have accomplished with your ability.", author: 'John Wooden' },
  { text: "Set your goals high, and don't stop till you get there.", author: 'Bo Jackson' },
  { text: "The vision of a champion is bent over, drenched in sweat, at the point of exhaustion, when nobody else is looking.", author: 'Mia Hamm' },
  { text: "Push yourself, because no one else is going to do it for you.", author: 'Unknown' },
  { text: "Success is no accident. It is hard work, perseverance, learning, studying, sacrifice, and most of all, love of what you do.", author: 'Pelé' },
  { text: "A trophy carries dust. Memories last forever.", author: 'Mary Lou Retton' },
  { text: "The secret of getting ahead is getting started.", author: 'Mark Twain' },
  { text: "It's not the size of the dog in the fight, but the size of the fight in the dog.", author: 'Archie Griffin' },
  { text: "You can't put a limit on anything. The more you dream, the farther you get.", author: 'Michael Phelps' },
  { text: "Somewhere behind the athlete you've become is a little kid who fell in love with the game and never looked back.", author: 'Mia Hamm' },
]

/** Returns the quote for today — stable within a calendar day. */
export function getDailyQuote(): Quote {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  return QUOTES[dayOfYear % QUOTES.length]
}
