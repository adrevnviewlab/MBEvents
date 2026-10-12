// Built-in event music library (title | artist | genre | category).
// "inLibrary" in the planner means MB already carries the track.
const RAW = `
Perfect|Ed Sheeran|Pop|First dance
Thinking Out Loud|Ed Sheeran|Pop|First dance
All of Me|John Legend|R&B|First dance
At Last|Etta James|Classic|First dance
Can't Help Falling in Love|Elvis Presley|Classic|First dance
A Thousand Years|Christina Perri|Pop|First dance
Make You Feel My Love|Adele|Pop|First dance
Die With A Smile|Lady Gaga & Bruno Mars|Pop|First dance
Lover|Taylor Swift|Pop|First dance
Until I Found You|Stephen Sanchez|Pop|First dance
Speechless|Dan + Shay|Country|First dance
Tennessee Whiskey|Chris Stapleton|Country|First dance
Wonderful Tonight|Eric Clapton|Classic Rock|First dance
I Don't Want to Miss a Thing|Aerosmith|Rock|First dance
Unchained Melody|The Righteous Brothers|Classic|First dance
Better Together|Jack Johnson|Acoustic|First dance
Marry Me|Train|Pop|Ceremony
Canon in D|Johann Pachelbel|Classical|Ceremony
Here Comes the Sun|The Beatles|Classic Rock|Ceremony
A Thousand Years (Piano)|The Piano Guys|Instrumental|Ceremony
Bridal Chorus|Richard Wagner|Classical|Ceremony
Wedding March|Felix Mendelssohn|Classical|Ceremony
Signed, Sealed, Delivered I'm Yours|Stevie Wonder|Motown|Ceremony
My Girl|The Temptations|Motown|Parent dance
What a Wonderful World|Louis Armstrong|Classic|Parent dance
My Little Girl|Tim McGraw|Country|Parent dance
I Loved Her First|Heartland|Country|Parent dance
Butterfly Kisses|Bob Carlisle|Pop|Parent dance
Isn't She Lovely|Stevie Wonder|Motown|Parent dance
A Song for Mama|Boyz II Men|R&B|Parent dance
Simple Man|Lynyrd Skynyrd|Classic Rock|Parent dance
Forever Young|Rod Stewart|Classic Rock|Parent dance
The Way You Look Tonight|Frank Sinatra|Classic|Parent dance
Sugar|Maroon 5|Pop|Cake cutting
Pour Some Sugar on Me|Def Leppard|Rock|Cake cutting
I Want Candy|Bow Wow Wow|80s|Cake cutting
Single Ladies (Put a Ring on It)|Beyonce|Pop|Bouquet toss
Girls Just Want to Have Fun|Cyndi Lauper|80s|Bouquet toss
Another One Bites the Dust|Queen|Classic Rock|Garter
Legs|ZZ Top|Classic Rock|Garter
Don't Stop Believin'|Journey|Classic Rock|Last dance
Closing Time|Semisonic|90s|Last dance
Time of My Life|Bill Medley & Jennifer Warnes|80s|Last dance
New York, New York|Frank Sinatra|Classic|Last dance
Sweet Caroline|Neil Diamond|Classic|Party
Uptown Funk|Mark Ronson ft. Bruno Mars|Pop|Party
Shut Up and Dance|Walk the Moon|Pop|Party
September|Earth, Wind & Fire|Funk|Party
Mr. Brightside|The Killers|Rock|Party
Dancing Queen|ABBA|Disco|Party
I Wanna Dance with Somebody|Whitney Houston|80s|Party
Shout|The Isley Brothers|Motown|Party
Livin' on a Prayer|Bon Jovi|80s|Party
You Shook Me All Night Long|AC/DC|Classic Rock|Party
Celebration|Kool & The Gang|Funk|Party
Don't Stop Me Now|Queen|Classic Rock|Party
Yeah!|Usher ft. Lil Jon & Ludacris|Hip Hop|Party
In Da Club|50 Cent|Hip Hop|Party
Crazy in Love|Beyonce ft. Jay-Z|R&B|Party
Hey Ya!|OutKast|Hip Hop|Party
Shake It Off|Taylor Swift|Pop|Party
Can't Stop the Feeling!|Justin Timberlake|Pop|Party
Levitating|Dua Lipa|Pop|Party
Espresso|Sabrina Carpenter|Pop|Party
Flowers|Miley Cyrus|Pop|Party
As It Was|Harry Styles|Pop|Party
Blinding Lights|The Weeknd|Pop|Party
Dance the Night|Dua Lipa|Pop|Party
Pink Pony Club|Chappell Roan|Pop|Party
APT.|ROSE & Bruno Mars|Pop|Party
Birds of a Feather|Billie Eilish|Pop|Party
Texas Hold 'Em|Beyonce|Country|Party
Love Story|Taylor Swift|Pop|Party
Cruel Summer|Taylor Swift|Pop|Party
Party in the U.S.A.|Miley Cyrus|Pop|Party
Wobble|V.I.C.|Hip Hop|Line dance
Cupid Shuffle|Cupid|R&B|Line dance
Cha Cha Slide|DJ Casper|Hip Hop|Line dance
Wobble Baby|V.I.C.|Hip Hop|Line dance
Electric Slide|Marcia Griffiths|Classic|Line dance
Macarena|Los del Rio|Latin|Line dance
Cotton Eye Joe|Rednex|Country|Line dance
Watch Me (Whip/Nae Nae)|Silento|Hip Hop|Line dance
Copperhead Road|Steve Earle|Country|Line dance
Y.M.C.A.|Village People|Disco|Line dance
The Git Up|Blanco Brown|Country|Line dance
Hava Nagila|Traditional|Traditional|Hora
Siman Tov / Mazel Tov|Traditional|Traditional|Hora
Hey Baby|DJ Otzi|Party|Party
Gasolina|Daddy Yankee|Latin|Party
Despacito|Luis Fonsi ft. Daddy Yankee|Latin|Party
Danza Kuduro|Don Omar & Lucenzo|Latin|Party
Vivir Mi Vida|Marc Anthony|Latin|Party
La Vida Es Un Carnaval|Celia Cruz|Latin|Party
Tusa|Karol G & Nicki Minaj|Latin|Party
Titi Me Pregunto|Bad Bunny|Latin|Party
De Musica Ligera|Soda Stereo|Latin|Party
Tiempo de Vals|Chayanne|Latin|Quince waltz
Quinceanera|Thalia|Latin|Quince waltz
Sweet Sixteen|Billy Idol|80s|Sweet 16
Birthday|Katy Perry|Pop|Sweet 16
22|Taylor Swift|Pop|Sweet 16
Dynamite|BTS|K-Pop|Sweet 16
Good as Hell|Lizzo|Pop|Sweet 16
Juice|Lizzo|Pop|Party
Rich Flex|Drake & 21 Savage|Hip Hop|Party
God's Plan|Drake|Hip Hop|Party
HUMBLE.|Kendrick Lamar|Hip Hop|Party
Not Like Us|Kendrick Lamar|Hip Hop|Party
SICKO MODE|Travis Scott|Hip Hop|Party
Old Town Road|Lil Nas X|Country|Party
Wagon Wheel|Darius Rucker|Country|Party
Friends in Low Places|Garth Brooks|Country|Party
Man! I Feel Like a Woman!|Shania Twain|Country|Party
Fly Me to the Moon|Frank Sinatra|Classic|Cocktail hour
L-O-V-E|Nat King Cole|Classic|Cocktail hour
Sway|Michael Buble|Jazz|Cocktail hour
Feeling Good|Michael Buble|Jazz|Cocktail hour
Come Away With Me|Norah Jones|Jazz|Cocktail hour
Sunday Morning|Maroon 5|Pop|Cocktail hour
Valerie|Amy Winehouse|Soul|Cocktail hour
Let's Stay Together|Al Green|Soul|Dinner
Ain't No Mountain High Enough|Marvin Gaye & Tammi Terrell|Motown|Dinner
Brown Eyed Girl|Van Morrison|Classic Rock|Dinner
Stand by Me|Ben E. King|Classic|Dinner
I Got You (I Feel Good)|James Brown|Funk|Party
Twist and Shout|The Beatles|Classic Rock|Party
Footloose|Kenny Loggins|80s|Party
Love Shack|The B-52's|80s|Party
Jump Around|House of Pain|90s|Party
Wannabe|Spice Girls|90s|Party
No Diggity|Blackstreet|90s|Party
Gettin' Jiggy wit It|Will Smith|90s|Party
Smells Like Teen Spirit|Nirvana|90s|Party
Freed from Desire|Gala|Dance|Party
Titanium|David Guetta ft. Sia|Dance|Party
Levels|Avicii|Dance|Party
Wake Me Up|Avicii|Dance|Party
Don't You Worry Child|Swedish House Mafia|Dance|Party
One More Time|Daft Punk|Dance|Party
Get Lucky|Daft Punk ft. Pharrell|Dance|Party
Good Feeling|Flo Rida|Dance|Party
Turn Down for What|DJ Snake & Lil Jon|Dance|Party
Lose Control|Teddy Swims|Pop|Party
Golden Hour|JVKE|Pop|Cocktail hour
`;

export type LibrarySong = { title: string; artist: string; genre: string; category: string };

export const musicLibrary: LibrarySong[] = RAW.trim()
  .split("\n")
  .map((line) => {
    const [title, artist, genre, category] = line.split("|");
    return { title, artist, genre, category };
  });

export const musicCategories = [...new Set(musicLibrary.map((s) => s.category))];
export const musicGenres = [...new Set(musicLibrary.map((s) => s.genre))].sort();

export function inLibrary(title: string, artist = "") {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const t = norm(title);
  const a = norm(artist);
  return musicLibrary.some((s) => norm(s.title) === t && (!a || norm(s.artist).includes(a) || a.includes(norm(s.artist))));
}

// Most-requested chart: top picks across categories, in the order MB sees them requested.
export const mostRequested = [
  "Don't Stop Believin'", "Mr. Brightside", "Uptown Funk", "September", "Shut Up and Dance", "Sweet Caroline",
  "Dancing Queen", "I Wanna Dance with Somebody", "Yeah!", "Cupid Shuffle", "Livin' on a Prayer", "Shout",
  "Espresso", "APT.", "Pink Pony Club", "Perfect", "Can't Help Falling in Love", "Wagon Wheel", "Titanium", "Gasolina",
].map((title) => musicLibrary.find((s) => s.title === title)!).filter(Boolean);
