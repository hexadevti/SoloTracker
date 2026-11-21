/*
 * SoloTracker — idiomas (português e inglês).
 *
 *   tr('Texto em português', { var })  → texto no idioma atual
 *
 * O português é o texto-fonte (e a chave). EN traz as traduções; um valor pode ser
 * uma função (vars) => string para plurais. "{nome}" é trocado por vars.nome.
 * Mensagens que chegam do processo principal, do preload, do separador (Python) e
 * do player web também passam por tr(): as que têm partes variáveis usam PATTERNS.
 *
 * Idioma: localStorage "solotracker-lang" ('pt' | 'en'); sem escolha, segue o
 * navegador/sistema (pt* → português, qualquer outro → inglês).
 */
(function () {
  'use strict';

  const LANG_KEY = 'solotracker-lang';
  const s = (n, one, many) => (Number(n) === 1 ? one : many);

  const EN = {
    // ------------------------------------------------------------ index.html (textos fixos)
    'Biblioteca de projetos (Ctrl+O)': 'Project library (Ctrl+O)',
    '📚 Biblioteca': '📚 Library',
    'Nome da música': 'Song name',
    'Nome do projeto (clique para editar)': 'Project name (click to edit)',
    'Exportar este projeto para um arquivo': 'Export this project to a file',
    '⤓ Exportar': '⤓ Export',
    'Cole um link do YouTube para abrir ou criar um projeto': 'Paste a YouTube link to open or create a project',
    Abrir: 'Open',
    'Cole um link do YouTube acima ou abra um projeto na': 'Paste a YouTube link above or open a project from the',
    Biblioteca: 'Library',
    'Arraste sobre o vídeo para avançar/voltar • Clique para play/pause •': 'Drag over the video to seek • Click to play/pause •',
    'cria um trecho,': 'creates a section,',
    'marca início e fim': 'marks start and end',
    'Arraste para avançar/voltar • Clique para play/pause': 'Drag to seek • Click to play/pause',
    'Zoom do loop': 'Loop zoom',
    'Voltar ao início do trecho (Backspace / Home / R)': 'Back to section start (Backspace / Home / R)',
    'Voltar (←)': 'Back (←)',
    'Play/Pause (Espaço)': 'Play/Pause (Space)',
    'Avançar (→)': 'Forward (→)',
    Velocidade: 'Speed',
    'Novo trecho: depois use Enter para marcar início e fim (N)': 'New section: then press Enter to mark start and end (N)',
    'Marcar início no tempo atual (A ou [)': 'Set start at the current time (A or [)',
    'Marcar A': 'Set A',
    'Mover A para trás': 'Move A back',
    'Mover A para frente': 'Move A forward',
    'Marcar fim no tempo atual (B ou ])': 'Set end at the current time (B or ])',
    'Marcar B': 'Set B',
    'Mover B para trás': 'Move B back',
    'Mover B para frente': 'Move B forward',
    'Liga/desliga loop (L)': 'Loop on/off (L)',
    'Limpar loop (Esc)': 'Clear loop (Esc)',
    'Trechos do projeto': 'Project sections',
    'Nenhum trecho ainda. Pressione': 'No sections yet. Press',
    'e depois': 'and then',
    'no início e': 'at the start and',
    'no fim do trecho.': 'at the end of the section.',
    Configurações: 'Settings',
    'Setas ← →': 'Arrows ← →',
    'Passo das setas (s)': 'Arrow step (s)',
    'Passo grande (s)': 'Big step (s)',
    'Ctrl + ← →, botões − + do loop e roda do mouse': 'Ctrl + ← →, loop − + buttons and mouse wheel',
    'Passo fino (s)': 'Fine step (s)',
    'Quantos segundos andam a cada 100px arrastados sobre o vídeo': 'Seconds moved for every 100px dragged over the video',
    'Sensibilidade do arraste (s/100px)': 'Drag sensitivity (s/100px)',
    'Pausa antes de repetir o loop': 'Pause before repeating the loop',
    'Pausa entre repetições (s)': 'Pause between repetitions (s)',
    'Volta alguns segundos antes do A ao iniciar o loop': 'Starts a few seconds before A when the loop begins',
    'Pré-roll ao ir para A (s)': 'Pre-roll when going to A (s)',
    Atalhos: 'Shortcuts',
    'Novo trecho': 'New section',
    'Marca início e depois fim do novo trecho': 'Marks the start, then the end, of the new section',
    'Cancela novo trecho / limpa loop': 'Cancels the new section / clears the loop',
    'Pular para o trecho 1…10': 'Jump to section 1…10',
    Espaço: 'Space',
    'Voltar / avançar (passo)': 'Back / forward (step)',
    'Passo grande': 'Big step',
    'Passo fino': 'Fine step',
    'Velocidade ±5% (salva no trecho)': 'Speed ±5% (saved in the section)',
    'Ajustar início / fim no tempo atual': 'Set start / end at the current time',
    'Liga/desliga loop': 'Loop on/off',
    'Liga/desliga a guitarra (offline, trilhas separadas)': 'Guitar on/off (offline, separated tracks)',
    'Voltar ao início do trecho': 'Back to section start',
    'Biblioteca de projetos': 'Project library',
    'Buscar música…': 'Search songs…',
    'Importar projetos de arquivos .json': 'Import projects from .json files',
    '⤒ Importar': '⤒ Import',
    'Novo projeto a partir de um arquivo de vídeo ou áudio deste aparelho': 'New project from a video or audio file on this device',
    'Fechar (Esc)': 'Close (Esc)',
    'Link do YouTube': 'YouTube link',
    'Nome da música (opcional)': 'Song name (optional)',
    '＋ Novo projeto': '＋ New project',

    // ------------------------------------------------------------ app.js
    'arquivo salvo': 'saved file',
    'vídeo baixado': 'downloaded video',
    'Salvando…': 'Saving…',
    'Salvo ✓': 'Saved ✓',
    'Nova música': 'New song',
    'Fora do trecho — loop livre': 'Outside the section — loop released',
    'Velocidade {pct}% · {name}': 'Speed {pct}% · {name}',
    'Velocidade {pct}%': 'Speed {pct}%',
    'Início = {t}': 'Start = {t}',
    'Fim = {t}': 'End = {t}',
    'Crie um trecho primeiro (＋ Novo trecho)': 'Create a section first (＋ New section)',
    'Crie um trecho primeiro (N)': 'Create a section first (N)',
    'Repetição {n}': 'Repetition {n}',
    'Novo trecho cancelado': 'New section canceled',
    'Trecho muito curto — deixe tocar um pouco antes de marcar o fim': 'Section too short — let it play a bit before marking the end',
    Trecho: 'Section',
    'Trecho {n}': 'Section {n}',
    '{name} salvo': '{name} saved',
    Cancelar: 'Cancel',
    Limpar: 'Clear',
    '＋ Novo trecho': '＋ New section',
    '● Marcar início': '● Mark start',
    '● Marcar fim': '● Mark end',
    'NOVO TRECHO — toque em <b>Marcar início</b>': 'NEW SECTION — tap <b>Mark start</b>',
    'Início {t} — toque em <b>Marcar fim</b>': 'Start {t} — tap <b>Mark end</b>',
    'NOVO TRECHO — <kbd>Enter</kbd> marca o <b>início</b> · <kbd>Esc</kbd> cancela':
      'NEW SECTION — <kbd>Enter</kbd> marks the <b>start</b> · <kbd>Esc</kbd> cancels',
    'Início {t} — <kbd>Enter</kbd> marca o <b>fim</b> · <kbd>Esc</kbd> cancela':
      'Start {t} — <kbd>Enter</kbd> marks the <b>end</b> · <kbd>Esc</kbd> cancels',
    Renomear: 'Rename',
    Excluir: 'Delete',
    'Excluir "{name}"?': 'Delete "{name}"?',
    'Novo projeto criado': 'New project created',
    'Arquivo não encontrado neste aparelho — tocando pelo YouTube': 'File not found on this device — playing from YouTube',
    'Vídeo baixado não encontrado — tocando pelo YouTube': 'Downloaded video not found — playing from YouTube',
    'O arquivo deste projeto ({name}) não está salvo neste aparelho.': "This project's file ({name}) is not saved on this device.",
    'O arquivo deste projeto não está salvo neste aparelho.': "This project's file is not saved on this device.",
    '📂 Escolher arquivo': '📂 Choose file',
    'Escolhendo o arquivo…': 'Choosing the file…',
    'Arquivo salvo neste aparelho — tocando offline': 'File saved on this device — playing offline',
    'Não foi possível usar o arquivo.': 'Could not use the file.',
    '📂 Escolhendo…': '📂 Choosing…',
    'Clique para cancelar.': 'Click to cancel.',
    '📂 Arquivo': '📂 File',
    'Tocando "{name}" ({size}), salvo neste aparelho.': 'Playing "{name}" ({size}), saved on this device.',
    'Clique para voltar a tocar pelo YouTube.': 'Click to play from YouTube again.',
    'Arquivo não encontrado neste aparelho.': 'File not found on this device.',
    'Tocando pelo YouTube. Clique para tocar o arquivo salvo neste aparelho.':
      'Playing from YouTube. Click to play the file saved on this device.',
    'Tocando pelo YouTube. Clique para escolher um arquivo de vídeo ou áudio deste aparelho (velocidade livre e loop preciso).':
      'Playing from YouTube. Click to choose a video or audio file on this device (any speed and precise loop).',
    '⏳ Baixando…': '⏳ Downloading…',
    'Baixando…': 'Downloading…',
    'Tocando o vídeo baixado ({size}), sem acessar o YouTube.\nClique para voltar a tocar pelo YouTube (online).':
      'Playing the downloaded video ({size}), without accessing YouTube.\nClick to play from YouTube again (online).',
    'Tocando pelo YouTube. O vídeo já está baixado: clique para tocar offline.':
      'Playing from YouTube. The video is already downloaded: click to play offline.',
    'Tocando pelo YouTube. Clique para baixar o vídeo e tocar offline.': 'Playing from YouTube. Click to download the video and play offline.',
    'Cancelar a escolha do arquivo?': 'Cancel choosing the file?',
    'Cancelar o download deste vídeo?': 'Cancel downloading this video?',
    'Este projeto toca um arquivo salvo neste aparelho': 'This project plays a file saved on this device',
    'Online — tocando pelo YouTube': 'Online — playing from YouTube',
    'Tocando o arquivo salvo neste aparelho': 'Playing the file saved on this device',
    'Offline — tocando o vídeo baixado': 'Offline — playing the downloaded video',
    'Preparando…': 'Preparing…',
    'Baixando o vídeo…': 'Downloading the video…',
    'Baixado em 360p (instale o ffmpeg para HD) — tocando offline': 'Downloaded in 360p (install ffmpeg for HD) — playing offline',
    'Baixado — tocando offline': 'Downloaded — playing offline',
    'Download cancelado': 'Download canceled',
    'Não foi possível baixar o vídeo.': 'Could not download the video.',
    'Se o YouTube pedir para confirmar que você não é um robô, espere um pouco e tente de novo.':
      "If YouTube asks you to confirm you're not a robot, wait a while and try again.",
    'Separando…': 'Separating…',
    'Separando a guitarra…': 'Separating the guitar…',
    '🎸 Guitarra: ON': '🎸 Guitar: ON',
    '🎸 Guitarra: OFF': '🎸 Guitar: OFF',
    'Clique para tirar a guitarra do áudio (G).': 'Click to remove the guitar from the audio (G).',
    'Clique para voltar a guitarra do áudio (G).': 'Click to bring the guitar back into the audio (G).',
    '🎸 Separar guitarra': '🎸 Separate guitar',
    'Separa a trilha de guitarra do áudio com IA (Demucs), para poder ligar e desligar a guitarra.\nLeva alguns minutos por música.':
      'Separates the guitar track from the audio with AI (Demucs), so you can turn the guitar on and off.\nTakes a few minutes per song.',
    'Cancelar a separação da guitarra?': 'Cancel the guitar separation?',
    'Na primeira vez o app instala o separador de áudio (Demucs + PyTorch, cerca de 1 GB em %APPDATA%/solotracker/stems-env). É preciso ter o Python 3.9–3.12 instalado.\n\nContinuar?':
      'The first time, the app installs the audio separator (Demucs + PyTorch, about 1 GB in %APPDATA%/solotracker/stems-env). Python 3.9–3.12 must be installed.\n\nContinue?',
    'Guitarra separada — use G para ligar/desligar': 'Guitar separated — press G to turn it on/off',
    'Separação cancelada': 'Separation canceled',
    'Não foi possível separar a guitarra.': 'Could not separate the guitar.',
    'Separar a guitarra só funciona no app para PC': 'Guitar separation only works in the desktop app',
    'Separe a guitarra primeiro (botão 🎸)': 'Separate the guitar first (🎸 button)',
    'Disponível só no modo offline': 'Only available in offline mode',
    'Guitarra ligada': 'Guitar on',
    'Guitarra desligada': 'Guitar off',
    'O {file} ({size}) também será apagado.': 'The {file} ({size}) will also be deleted.',
    'Excluir o projeto "{name}" e seus {n} trecho(s)?': (v) =>
      `Delete the project "${v.name}" and its ${v.n} ${s(v.n, 'section', 'sections')}?`,
    'Projeto exportado': 'Project exported',
    'Nenhum projeto válido nos arquivos': 'No valid projects in the files',
    '{n} projeto(s) importado(s)': (v) => `${v.n} ${s(v.n, 'project', 'projects')} imported`,
    'Nenhum projeto encontrado.': 'No projects found.',
    'Nenhum projeto ainda. Crie um com um link do YouTube ou com 📂 Arquivo (vídeo ou música do aparelho).':
      'No projects yet. Create one with a YouTube link or with 📂 File (a video or song on this device).',
    'Nenhum projeto ainda. Crie um com um link do YouTube.': 'No projects yet. Create one with a YouTube link.',
    salvo: 'saved',
    arquivo: 'file',
    vídeo: 'video',
    'arquivo não está neste aparelho': 'file is not on this device',
    '💾 baixado': '💾 downloaded',
    ' · 🎸 separada': ' · 🎸 separated',
    'Apagar o arquivo salvo neste aparelho (o projeto volta a tocar pelo YouTube)':
      'Delete the file saved on this device (the project goes back to playing from YouTube)',
    'Apagar o arquivo salvo neste aparelho (os trechos continuam)': 'Delete the file saved on this device (the sections are kept)',
    'Apagar o vídeo baixado (o projeto volta a tocar pelo YouTube)': 'Delete the downloaded video (the project goes back to playing from YouTube)',
    '{n} trecho(s)': (v) => `${v.n} ${s(v.n, 'section', 'sections')}`,
    'Exportar para arquivo': 'Export to file',
    'Excluir projeto': 'Delete project',
    'Apagar o {file} de "{name}" ({size})?': 'Delete the {file} of "{name}" ({size})?',
    'Não foi possível carregar as trilhas separadas — tocando o áudio original': 'Could not load the separated tracks — playing the original audio',
    'O YouTube tocou a {pct}% (mais próxima). Use um arquivo para velocidade livre':
      'YouTube is playing at {pct}% (the closest). Use a file for any speed',
    'Toque no vídeo para começar': 'Tap the video to start',
    'Clique no vídeo para começar': 'Click the video to start',
    'Prepare-se…': 'Get ready…',
    'O navegador não conseguiu tocar este arquivo (formato não suportado?). Escolha outro arquivo.':
      "The browser couldn't play this file (unsupported format?). Choose another file.",
    '📂 Escolher outro arquivo': '📂 Choose another file',
    '▶ Tocar pelo YouTube': '▶ Play from YouTube',
    'O arquivo pode estar corrompido. Volte para o YouTube ou apague e baixe de novo pela Biblioteca.':
      'The file may be corrupted. Go back to YouTube, or delete it and download it again from the Library.',
    '🌐 Tocar pelo YouTube': '🌐 Play from YouTube',
    'Alguns vídeos não permitem reprodução fora do YouTube. Você pode tocar um arquivo de vídeo ou áudio salvo neste aparelho.':
      "Some videos can't be played outside YouTube. You can play a video or audio file saved on this device.",
    'Abrir no YouTube': 'Open on YouTube',
    '📂 Tocar o arquivo salvo': '📂 Play the saved file',
    '📂 Usar um arquivo do aparelho': '📂 Use a file from this device',
    'Alguns vídeos não permitem reprodução incorporada, e o YouTube pode bloquear o acesso temporariamente. Baixar o vídeo costuma resolver.':
      "Some videos don't allow embedded playback, and YouTube may block access temporarily. Downloading the video usually solves it.",
    '💾 Tocar offline': '💾 Play offline',
    '💾 Baixar e tocar offline': '💾 Download and play offline',
    'Pressione N para criar um novo trecho': 'Press N to create a new section',
    'Abra um projeto primeiro': 'Open a project first',
    Automático: 'Automatic',

    // ------------------------------------------------------------ versão web (web-api.js, mobile.js)
    'Não há espaço no navegador para guardar este arquivo. Apague arquivos de outros projetos na Biblioteca.':
      "There's no room in the browser to store this file. Delete files from other projects in the Library.",
    'Link de vídeo inválido.': 'Invalid video link.',
    'O player do YouTube não conseguiu tocar este vídeo neste navegador.': "The YouTube player couldn't play this video in this browser.",
    'Vídeo não encontrado (removido ou privado).': 'Video not found (removed or private).',
    'O dono do vídeo não permite que ele toque fora do YouTube.': "The video's owner doesn't allow it to play outside YouTube.",
    'O YouTube recusou o player desta página.': 'YouTube refused the player on this page.',
    'Não foi possível carregar o player do YouTube. Verifique a conexão com a internet.':
      "Couldn't load the YouTube player. Check your internet connection.",
    'O arquivo deste projeto não foi encontrado neste aparelho.': "This project's file was not found on this device.",
    'Operação cancelada': 'Operation canceled',
    projeto: 'project',
    'Projeto SoloTracker': 'SoloTracker project',
    celular: 'phone',
    Celular: 'Phone',
    'Layout da tela. Automático detecta celular ou PC.': 'Screen layout. Automatic detects phone or desktop.',
    '🎛 Controles': '🎛 Controls',
    '📌 Trechos': '📌 Sections',
    '⚙ Ajustes': '⚙ Settings',
    'Tela cheia': 'Full screen',
    'No iPhone, para usar em tela cheia: toque em Compartilhar e depois em "Adicionar à Tela de Início". Abra o SoloTracker pelo ícone criado.':
      'On iPhone, to use full screen: tap Share, then "Add to Home Screen". Open SoloTracker from the new icon.',
    'Abra a': 'Open the',
    'para criar um projeto com um link do YouTube ou um arquivo do celular.': 'to create a project from a YouTube link or a file on your phone.',
    'Arraste sobre o vídeo para avançar/voltar • Toque para play/pause': 'Drag over the video to seek • Tap to play/pause',
    'Nenhum trecho ainda. Toque em "＋ Novo trecho", depois toque no início e no fim do trecho.':
      'No sections yet. Tap "＋ New section", then tap at the start and at the end of the section.',
    'Gire o celular para usar deitado.': 'Turn your phone sideways to use it.',
    'Continuar assim': 'Continue like this',
    'Vídeo em tela cheia': 'Full-screen video',
    'Sair da tela cheia': 'Exit full screen',
    '1 toque: play/pause': '1 tap: play/pause',
    '2 toques: início do trecho': '2 taps: back to section start',
    'Arrastar ← →: voltar/avançar': 'Drag ← →: rewind/forward',
    'Arrastar ↑ ↓: sair da tela cheia': 'Drag ↑ ↓: exit full screen',
    '2 dedos ↑ ↓: velocidade': '2 fingers ↑ ↓: speed',
    '2 dedos ← →: voltar/avançar rápido': '2 fingers ← →: fast rewind/forward',
    'Pinça: zoom': 'Pinch: zoom',
    'Botão +: novo trecho (● marca o início, ■ marca o fim)': '+ button: new section (● marks the start, ■ marks the end)',
    'Marcar início': 'Mark start',
    'Marcar fim': 'Mark end',
    'Sair do trecho': 'Leave section',
    'Saiu do trecho': 'Left the section',
    'Trecho excluído': 'Section deleted',
    'Toque para começar': 'Tap to start',
    '⏮ Início do trecho': '⏮ Section start',
    '⏮ Início': '⏮ Start',
    '📚 Abrir projeto': '📚 Open project',
    'Tocar por': 'Play from',
    'Arraste sobre o vídeo para avançar/voltar • Toque para play/pause • Dois toques: tela cheia':
      'Drag over the video to seek • Tap to play/pause • Double tap: full screen',

    // ------------------------------------------------------------ timeline.js
    '{name} ({a} → {b}) — clique para abrir': '{name} ({a} → {b}) — click to open',

    // ------------------------------------------------------------ app para PC (main.js, preload.js, separate.py)
    'Baixando o yt-dlp (só na primeira vez)…': 'Downloading yt-dlp (first time only)…',
    'Atualizando o yt-dlp…': 'Updating yt-dlp…',
    'Baixando vídeo…': 'Downloading video…',
    'Baixando áudio…': 'Downloading audio…',
    'Juntando áudio e vídeo…': 'Merging audio and video…',
    'Conectando ao YouTube…': 'Connecting to YouTube…',
    'ID de vídeo inválido.': 'Invalid video ID.',
    'Este vídeo já está sendo baixado.': 'This video is already being downloaded.',
    'O download terminou, mas o arquivo de vídeo não foi encontrado.': 'The download finished, but the video file was not found.',
    'Procurando o Python…': 'Looking for Python…',
    'É preciso ter o Python 3.9 a 3.12 instalado (python.org ou "winget install Python.Python.3.12").':
      'Python 3.9 to 3.12 must be installed (python.org or "winget install Python.Python.3.12").',
    'Criando o ambiente Python…': 'Creating the Python environment…',
    'Instalando o PyTorch (~250 MB, só na primeira vez)…': 'Installing PyTorch (~250 MB, first time only)…',
    'Instalando o Demucs…': 'Installing Demucs…',
    'Instalando dependências…': 'Installing dependencies…',
    'A separação deste vídeo já está em andamento.': 'This video is already being separated.',
    'Baixe o vídeo (modo offline) antes de separar a guitarra.': 'Download the video (offline mode) before separating the guitar.',
    'A separação terminou, mas as trilhas não foram encontradas.': 'The separation finished, but the tracks were not found.',
    'Lendo o áudio do vídeo…': "Reading the video's audio…",
    'Carregando o modelo de separação…': 'Loading the separation model…',
    'Separando a guitarra (pode levar alguns minutos)…': 'Separating the guitar (may take a few minutes)…',
    'Salvando as trilhas…': 'Saving the tracks…',
    Pronto: 'Done',
  };

  /** Mensagens com partes variáveis (vindas de fora do renderer). */
  const PATTERNS = [
    [/^Não foi possível baixar o yt-dlp \(HTTP (\d+)\)\.$/, (m) => `Could not download yt-dlp (HTTP ${m[1]}).`],
    [/^yt-dlp terminou com código (-?\d+)\.$/, (m) => `yt-dlp exited with code ${m[1]}.`],
    [/^código (-?\d+)$/, (m) => `code ${m[1]}`],
    [/^(.+?) falhou:\n([\s\S]*)$/, (m) => `${translate(m[1] + '…').replace(/…$/, '')} failed:\n${m[2]}`],
    [/^Não foi possível tocar o vídeo baixado(?: \(código (\d+)\))?\.$/, (m) => `Could not play the downloaded video${m[1] ? ` (code ${m[1]})` : ''}.`],
    [
      /^Não foi possível tocar este arquivo(?: \(código (\d+)\))?\. O formato pode não ser suportado por este navegador\.$/,
      (m) => `Could not play this file${m[1] ? ` (code ${m[1]})` : ''}. The format may not be supported by this browser.`,
    ],
    [/^Erro do YouTube \(código (-?\d+)\)\.$/, (m) => `YouTube error (code ${m[1]}).`],
  ];

  function readStored() {
    // App de PC: a porta do servidor local muda a cada abertura (e com ela o localStorage);
    // o idioma fica no arquivo de dados e chega pelo preload.
    const solo = window.solo;
    if (solo && typeof solo.lang === 'string') return solo.lang === 'pt' || solo.lang === 'en' ? solo.lang : '';
    try {
      const v = localStorage.getItem(LANG_KEY);
      return v === 'pt' || v === 'en' ? v : '';
    } catch {
      return '';
    }
  }
  function detect() {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).filter(Boolean);
    return /^pt\b/i.test(list[0] || 'pt') ? 'pt' : 'en';
  }

  const forced = readStored();
  const autoLang = detect();
  const lang = forced || autoLang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';

  const fill = (str, vars) => (vars ? str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : str);

  function translate(pt, vars) {
    if (pt == null) return '';
    const key = String(pt);
    if (lang === 'pt') return fill(key, vars);
    const v = EN[key];
    if (typeof v === 'function') return v(vars || {});
    if (typeof v === 'string') return fill(v, vars);
    for (const [re, fn] of PATTERNS) {
      const m = key.match(re);
      if (m) return fn(m);
    }
    return fill(key, vars); // sem tradução: mostra o original
  }

  /** Traduz os textos fixos de um trecho do DOM (texto, title, placeholder, aria-label). */
  function translateDom(root) {
    if (lang === 'pt' || !root) return;
    const base = root.body || root;
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const raw = node.nodeValue;
      const key = raw.trim();
      if (!key || !(key in EN) || typeof EN[key] !== 'string') continue;
      const lead = raw.match(/^\s*/)[0];
      const trail = raw.match(/\s*$/)[0];
      node.nodeValue = lead + EN[key] + trail;
    }
    base.querySelectorAll('[title], [placeholder], [aria-label]').forEach((el) => {
      for (const attr of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v && typeof EN[v] === 'string') el.setAttribute(attr, EN[v]);
      }
    });
  }

  window.tr = translate;
  window.I18N = {
    lang,
    forced,
    autoLang,
    locale: lang === 'en' ? 'en-US' : 'pt-BR',
    translateDom,
    /** '' = automático. Vale depois de recarregar a página. */
    setLang(value) {
      try {
        if (value === 'pt' || value === 'en') localStorage.setItem(LANG_KEY, value);
        else localStorage.removeItem(LANG_KEY);
      } catch {
        /* ignore */
      }
    },
  };
})();
