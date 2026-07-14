// Natural Sinhala romantic tone + poetic English translations

const romanticFlow = {
  // ── Loading Screen ───────────────────────────────────────────────
  loading_line1: {
    si: 'සමහර කතා ආරම්භ වෙන්නෙ අවුරුදු ගණනාවක් ගිය පසුව...',
    en: 'Some stories begin after years of waiting...',
  },

  loading_line2: {
    si: 'ඒත් සමහර කතා... එකම එක මොහොතකින් හිතේ ලියවෙනවා.',
    en: 'But some stories... are written in the heart in a single moment.',
  },

  // ── Hero Screen ───────────────────────────────────────────────
  hero_title: {
    si: 'එක් හමුවීමක්...',
    en: 'One Beautiful Encounter',
  },

  hero_sub: {
    si: 'සමහරවිට ජීවිතයක් වෙනස් කරන්නෙ කාලය නෙමෙයි... එක පුංචි මොහොතක්.',
    en: 'Sometimes it is not time that changes a life... but one beautiful moment.',
  },

  hero_button: {
    si: 'මේ කතාව අරඹන්න →',
    en: 'Begin This Story →',
  },

  // ── Name Screen ───────────────────────────────────────────────
  name_prompt: {
    si: 'මේ පුංචි කතාව ලියවුණේ ඔයා වෙනුවෙන්මයි.',
    en: 'This little story was written just for you.',
  },

  name_sub: {
    si: 'ඔයාගේ නම කියන්න... මේ මොහොත අපි දෙන්නා අතරේ පුංචි රහසක් වේවි.',
    en: 'Tell me your name... this moment will stay as a little secret between us.',
  },

  name_placeholder: {
    si: 'ඔයාගේ නම...',
    en: 'Your name...',
  },

  name_continue: {
    si: 'ඉදිරියට →',
    en: 'Continue →',
  },

  // ── Date Entry Screen ───────────────────────────────────────────────
  date_hint_0: {
    si: (name) => `${name}, ඒ විශේෂ දවස තාමත් මතකද...`,
    en: (name) => `${name}, do you still remember that special day...`,
  },

  date_hint_1: {
    si: 'අපි මුලින්ම හමු වූ ඒ මොහොත මතක් කරගන්න...',
    en: 'Think back to the moment we first met...',
  },

  date_hint_2: {
    si: 'දින ගණනට වඩා... ඒ හැඟීම වැදගත් 🤍',
    en: 'More than the date... the feeling is what matters 🤍',
  },

  // ── Chapter 1 ───────────────────────────────────────────────
  ch1_line1: {
    si: 'අපි හමු වුණේ එකම එක වතාවක් විතරයි.',
    en: 'We have only met once.',
  },

  ch1_line2: {
    si: 'ඔයා ගැන මම තාම ගොඩක් දේවල් දන්නෙ නැහැ.',
    en: 'I still do not know many things about you.',
  },

  ch1_line3: {
    si: 'ඔයාටත් මාව තාම හඳුනන්නෙ නැතුව ඇති.',
    en: 'You probably do not know much about me either.',
  },

  // ── Chapter 2 ───────────────────────────────────────────────
  ch2_intro: {
    si: 'ඒ කෙටි හමුවීම ඇතුළේ... අදටත් මතකයේ රැඳුණු පුංචි මොහොතවල් තිබුණා.',
    en: 'Within that short meeting... there were little moments I still carry with me.',
  },

  // ── Chapter 3 ───────────────────────────────────────────────
  ch3_title: {
    si: (name) => `${name}... මට ඔයාට දෙයක් කියන්න තියෙනවා.`,
    en: (name) => `${name}... there is something I want to tell you.`,
  },

  ch3_body: {
    si: 'මේ හැඟීම හදිසියේ ආපු දෙයක් නෙමෙයි... ඒත් තවත් හිත ඇතුළේ සඟවාගෙන ඉන්න මට බැහැ.',
    en: 'This feeling did not appear overnight... but I can no longer keep it hidden in my heart.',
  },

  ch3_italic: {
    si: 'සමහර හමුවීම් කෙටි වුණත්... ඒවායේ මතක දිගු කාලයක් රැඳෙනවා.',
    en: 'Some meetings are brief... but their memories stay for a lifetime.',
  },

  // ── Letter ───────────────────────────────────────────────
  letter_line1: {
    si: 'ඔයාව දැකලා තියෙන්නේ එකම එක වතාවක් විතරයි...',
    en: 'I have only seen you once...',
  },

  letter_line2: {
    si: 'සමහරවිට මේක ඔයාට පුදුමයක් වෙන්න පුළුවන්...',
    en: 'Maybe this comes as a surprise...',
  },

  letter_line3: {
    si: 'ඒත් ඒ හමුවීම මගේ හිතේ පුංචි ලස්සන මතකයක් වුණා.',
    en: 'But that meeting became a beautiful little memory in my heart.',
  },

  letter_line4: {
    si: 'ඔයාව තවත් හඳුනාගන්න... ඔයා සමඟ තවත් මතක හදන්න අවස්ථාවක් ලැබුණොත් ඒක මට ගොඩක් වටිනවා.',
    en: 'If I get the chance to know you better... and create more memories with you, it would mean a lot to me.',
  },

  letter_closing: {
    si: 'හදවතින්ම...',
    en: 'With all my heart...',
  },

  // ── Reveal ───────────────────────────────────────────────
  reveal_line1: {
    si: 'මේ කතාව ලියවුණේ කා වෙනුවෙන්ද කියලා...',
    en: 'The person this story was written for...',
  },

  reveal_name: {
    si: (name) => `${name}... ඒ ඔයා.`,
    en: (name) => `${name}... it was you.`,
  },

  // ── Memory Scene ───────────────────────────────────────────────
  memory_label: {
    si: 'හිතේ රැඳුණු මතකයක්',
    en: 'A memory worth keeping',
  },

  memory_days: {
    si: (days) => `ඒ මොහොතෙන් දින ${days}ක් ගෙවිලා... ඒත් ඒ මතකය තාමත් අලුත් වගේ.`,
    en: (days) => `${days} days have passed since that moment... yet the memory still feels new.`,
  },

  memory_body: {
    si: 'ඒ හමුවීම... ඒ සිනහව... ඒ පුංචි මොහොතවල් අදටත් මගේ මතකයේ ලස්සන තැනක තියෙනවා.',
    en: 'That meeting... that smile... those little moments still live in a beautiful corner of my memories.',
  },

  memory_question: {
    si: 'මේ හැඟීමට පුංචි අවස්ථාවක් දෙන්න කැමතිද?',
    en: 'Would you like to give this feeling a little chance?',
  },

  // ── Response Screen ───────────────────────────────────────────────
  response_prompt: {
    si: 'ඔයාගේ හිතේ ඇත්ත මට කියන්න...',
    en: 'Tell me what your heart truly feels...',
  },

  response_sub: {
    si: 'කිසිම බලපෑමක් නැහැ... ඔයාගේ හැඟීම මට වටිනවා.',
    en: 'There is no pressure... your feelings matter to me.',
  },

  response_yes: {
    si: '💙 ඔයා ගැන තවත් දැනගන්න කැමතියි',
    en: '💙 I would like to know you better',
  },

  response_thanks: {
    si: '🤍 මේක කියවලා මට අවස්ථාවක් දුන්නට ස්තූතියි',
    en: '🤍 Thank you for taking the time to read this',
  },

  response_time: {
    si: '🌼 මට ටිකක් කාලයක් ඕනේ',
    en: '🌼 I need a little time',
  },
};

export default romanticFlow;
