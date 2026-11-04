// ESC-Ikonen: von Hand gewählte Lieder, die man kennt oder die für den ESC stehen.
// Einfach Zeilen streichen oder ergänzen, die Id steht in app/data/esc_songs.json.
export const IKONEN = new Set([
  '1956-CH', // Lys Assia – Refrain
  '1958-IT', // Domenico Modugno – Nel blu, dipinto di blu
  '1964-IT', // Gigliola Cinquetti – Non ho l'età
  '1965-LU', // France Gall – Poupée de cire, poupée de son
  '1966-AT', // Udo Jürgens – Merci, Chérie
  '1967-GB', // Sandie Shaw – Puppet on a String
  '1968-ES', // Massiel – La La La
  '1968-GB', // Cliff Richard – Congratulations
  '1969-ES', // Salomé – Vivo cantando
  '1969-GB', // Lulu – Boom Bang-a-Bang
  '1970-IE', // Dana – All Kinds of Everything
  '1971-MC', // Séverine – Un banc, un arbre, une rue
  '1972-LU', // Vicky Leandros – Après toi
  '1973-LU', // Anne-Marie David – Tu te reconnaîtras
  '1973-ES', // Mocedades – Eres tú
  '1974-SE', // ABBA – Waterloo
  '1974-IT', // Gigliola Cinquetti – Sì
  '1975-NL', // Teach-In – Ding-a-dong
  '1976-GB', // Brotherhood of Man – Save Your Kisses for Me
  '1977-FR', // Marie Myriam – L'Oiseau et l'Enfant
  '1978-IL', // Izhar Cohen and the Alphabeta – A-Ba-Ni-Bi
  '1979-IL', // Milk and Honey – Hallelujah
  '1979-DE', // Dschinghis Khan – Dschinghis Khan
  '1980-IE', // Johnny Logan – What's Another Year
  '1980-DE', // Katja Ebstein – Theater
  '1981-GB', // Bucks Fizz – Making Your Mind Up
  '1982-DE', // Nicole – Ein bißchen Frieden
  '1983-LU', // Corinne Hermès – Si la vie est cadeau
  '1983-IL', // Ofra Haza – Chai
  '1984-SE', // Herreys – Diggi-Loo Diggi-Ley
  '1985-NO', // Bobbysocks – La det swinge
  '1986-BE', // Sandra Kim – J'aime la vie
  '1987-IE', // Johnny Logan – Hold Me Now
  '1987-DE', // Wind – Laß die Sonne in dein Herz
  '1988-CH', // Céline Dion – Ne partez pas sans moi
  '1989-YU', // Riva – Rock Me
  '1990-IT', // Toto Cutugno – Insieme: 1992
  '1991-SE', // Carola – Fångad av en stormvind
  '1992-IE', // Linda Martin – Why Me
  '1993-IE', // Niamh Kavanagh – In Your Eyes
  '1994-IE', // Paul Harrington and Charlie McGettigan – Rock 'n' Roll Kids
  '1994-PL', // Edyta Górniak – To nie ja!
  '1995-NO', // Secret Garden – Nocturne
  '1996-IE', // Eimear Quinn – The Voice
  '1997-GB', // Katrina and the Waves – Love Shine a Light
  '1998-IL', // Dana International – Diva
  '1998-DE', // Guildo Horn – Guildo hat euch lieb
  '1999-SE', // Charlotte Nilsson – Take Me to Your Heaven
  '1999-IS', // Selma – All Out of Luck
  '2000-DK', // Olsen Brothers – Fly on the Wings of Love
  '2000-DE', // Stefan Raab – Wadde hadde dudde da?
  '2001-EE', // Tanel Padar, Dave Benton and 2XL – Everybody
  '2002-LV', // Marie N – I Wanna
  '2003-TR', // Sertab Erener – Everyway That I Can
  '2003-RU', // t.A.T.u. – Ne ver', ne boisia
  '2003-BE', // Urban Trad – Sanomi
  '2004-UA', // Ruslana – Wild Dances
  '2005-GR', // Helena Paparizou – My Number One
  '2006-FI', // Lordi – Hard Rock Hallelujah
  '2007-RS', // Marija Šerifović – Molitva
  '2007-UA', // Verka Serduchka – Dancing Lasha Tumbai
  '2008-RU', // Dima Bilan – Believe
  '2008-IE', // Dustin the Turkey – Irelande Douze Pointe
  '2009-NO', // Alexander Rybak – Fairytale
  '2010-DE', // Lena – Satellite
  '2011-AZ', // Ell and Nikki – Running Scared
  '2011-IE', // Jedward – Lipstick
  '2012-SE', // Loreen – Euphoria
  '2012-RU', // Buranovskiye Babushki – Party for Everybody
  '2013-DK', // Emmelie de Forest – Only Teardrops
  '2013-RO', // Cezar – It's My Life
  '2014-AT', // Conchita Wurst – Rise Like a Phoenix
  '2014-NL', // The Common Linnets – Calm After the Storm
  '2015-SE', // Måns Zelmerlöw – Heroes
  '2016-UA', // Jamala – 1944
  '2016-AU', // Dami Im – Sound of Silence
  '2016-RU', // Sergey Lazarev – You Are the Only One
  '2017-PT', // Salvador Sobral – Amar pelos dois
  '2017-IT', // Francesco Gabbani – Occidentali's Karma
  '2017-MD', // SunStroke Project – Hey Mamma
  '2018-IL', // Netta – Toy
  '2018-CY', // Eleni Foureira – Fuego
  '2019-NL', // Duncan Laurence – Arcade
  '2019-IT', // Mahmood – Soldi
  '2020-RU', // Little Big – Uno
  '2020-IS', // Daði og Gagnamagnið – Think About Things
  '2021-IT', // Måneskin – Zitti e buoni
  '2021-FR', // Barbara Pravi – Voilà
  '2021-UA', // Go_A – Shum
  '2021-FI', // Blind Channel – Dark Side
  '2022-UA', // Kalush Orchestra – Stefania
  '2022-GB', // Sam Ryder – Space Man
  '2022-ES', // Chanel – SloMo
  '2023-SE', // Loreen – Tattoo
  '2023-FI', // Käärijä – Cha Cha Cha
  '2024-CH', // Nemo – The Code
  '2024-HR', // Baby Lasagna – Rim Tim Tagi Dim
  '2024-NL', // Joost Klein – Europapa
  '2024-IE', // Bambie Thug – Doomsday Blue
  '2025-AT', // JJ – Wasted Love
  '2025-SE', // KAJ – Bara bada bastu
  '2025-EE', // Tommy Cash – Espresso Macchiato
  '2026-BG', // Dara – Bangaranga
]);
