# SoloTracker

Player de YouTube em Electron feito para estudar solos de guitarra.

## Rodar

```bash
npm install
npm start
```

Cole um link do YouTube (ou só o ID) e clique em **Abrir**. Também dá para colar com `Ctrl+V` em qualquer lugar ou arrastar o link para a janela.

## Projetos e trechos

Cada música é um **projeto**: um vídeo do YouTube com seus trechos de treino.

- **Abrir** um link reabre o projeto desse vídeo, se já existir. Se não existir, cria um novo com o título do vídeo como nome.
- A **Biblioteca** (`Ctrl+O`) lista todos os projetos, com busca. Nela você pode:
  - abrir, renomear, exportar ou excluir um projeto;
  - criar um **novo projeto** com um nome próprio (dá para ter vários projetos do mesmo vídeo);
  - **importar** arquivos `.solotracker.json`.
- O nome do projeto pode ser editado direto no topo. Tudo é salvo automaticamente ("Salvo ✓").
- Ao iniciar, o app reabre o último projeto.

**Criar um trecho:** pressione `N`. Depois aperte `Enter` no início do trecho e `Enter` de novo no fim. O trecho é salvo com a velocidade atual e entra em loop na hora. `Esc` cancela.

- Mudar a velocidade (`=`/`-`, `↑`/`↓`, slider ou presets) com um trecho selecionado grava a nova velocidade nele. A exceção é o treino progressivo ligado, que muda a velocidade sozinho.
- Cada trecho tem os botões ✎ (renomeia; duplo clique também) e ✕ (exclui).
- Ajustes de A/B (teclas `A`/`B`, botões −/+, alças da linha do tempo) feitos com um trecho selecionado são gravados nele.
- Use as teclas `1`–`9` e `0` (trecho 10) para pular entre os trechos.
- Arrastar a posição para fora do trecho, na linha do tempo ou sobre o vídeo, solta o loop: o trecho é desselecionado e o vídeo toca livre. Para voltar ao loop, clique no trecho ou digite o número dele. Se você voltar para dentro do trecho antes de soltar, o loop continua. As setas, a roda do mouse e os botões ⟲ ⟳ também soltam o loop quando passam do fim do trecho.
- Na linha do tempo principal, os outros trechos salvos aparecem como blocos cinza numerados. Clique em um para pular para ele, ou arraste a partir dele para navegar normalmente.

## Online e offline

Cada projeto toca em um de dois modos. O botão ao lado do nome do projeto mostra o modo atual e alterna entre eles:

- **🌐 Online**: toca pelo embed do YouTube.
- **💾 Offline**: toca o vídeo baixado no computador, sem acessar o YouTube. Loops e seeks não fazem requisições, o que evita o bloqueio por excesso de acessos.

Na primeira vez que você passa um projeto para offline, o vídeo é baixado com o [yt-dlp](https://github.com/yt-dlp/yt-dlp). O botão mostra o progresso, e clicar nele de novo cancela. Depois do download, o botão alterna na hora, mantendo a posição e o loop.

- O app usa o `yt-dlp` do PATH, se houver (`winget install yt-dlp.yt-dlp`). Se não houver, baixa o executável oficial para `%APPDATA%/solotracker/bin` e o atualiza a cada 7 dias.
- **Qualidade:** com o [ffmpeg](https://ffmpeg.org) no PATH (`winget install Gyan.FFmpeg`), baixa até 1080p. Sem ele, o YouTube só oferece arquivo único em 360p.
- Os vídeos ficam em `%APPDATA%/solotracker/videos`. Projetos do mesmo vídeo compartilham o arquivo.
- Na Biblioteca, **🗑 vídeo** apaga o arquivo baixado, e o projeto volta para o modo online. Excluir o último projeto de um vídeo também apaga o arquivo.
- Se o YouTube pedir para confirmar que você não é um robô durante o download, espere um pouco e tente de novo.

## Separar a guitarra (só offline)

No modo offline aparece o botão **🎸 Separar guitarra**. Ele separa a trilha de guitarra do resto da música com o [Demucs](https://github.com/facebookresearch/demucs) (modelo `htdemucs_6s`). Depois disso, o botão vira **🎸 Guitarra: ON/OFF**, e a tecla `G` liga e desliga a guitarra. A escolha fica salva por projeto.

- A separação roda na CPU e leva alguns minutos por música. O botão mostra o progresso, e clicar nele cancela.
- **Primeira vez:** o app cria um ambiente Python em `%APPDATA%/solotracker/stems-env` e instala PyTorch (CPU), Demucs e PyAV, cerca de 1 GB. Também baixa o modelo (~80 MB). É preciso ter o **Python 3.9 a 3.12** instalado.
- As trilhas ficam em `%APPDATA%/solotracker/stems/<videoId>/` (`guitar.flac` e `backing.flac`). Apagar o vídeo baixado apaga as trilhas também.
- Com as trilhas, o vídeo toca mudo, e o som vem das duas trilhas, sincronizadas com o vídeo (play, seek, loop e velocidade com o tom preservado).
- A separação é feita por IA e não é perfeita: em mixagens densas sobra um pouco de guitarra no acompanhamento, e vice-versa.

## Recursos

- **Loop A-B preciso**: verificado a cada frame dentro do player, com contador de repetições.
- **Zoom do loop**: uma segunda linha do tempo mostra só o trecho, com alças A/B arrastáveis para ajuste fino.
- **Velocidade de 25% a 150%** em passos de 1%, mantendo o tom (pitch preservado).
- **Arrastar sobre o vídeo** (mouse ou dedo) avança e volta. A sensibilidade é configurável.
- **Setas** voltam/avançam com passo configurável (normal, grande com `Shift`, fino com `Ctrl`).
- **Treino progressivo**: aumenta a velocidade a cada N repetições até a meta.
- **Pausa entre repetições** e **pré-roll** antes do A.
- Retoma de onde você parou (posição, loop e velocidade por projeto).

Os dados ficam em `%APPDATA%/solotracker/solotracker-data.json`. Dados do formato antigo (trechos por vídeo) são convertidos automaticamente em projetos.

## Como funciona

- A interface é servida por um servidor HTTP local em `http://localhost:<porta>`. O embed do YouTube exige um referrer válido: com `file://` ou `127.0.0.1` ele mostra "vídeo indisponível".
- No modo offline, o iframe carrega `player.html`, um `<video>` que toca `/media/<videoId>`. O servidor local serve o arquivo com suporte a `Range` (necessário para o seek). A mesma ponte do preload controla esse player.
- O `preload.js` também roda dentro do iframe do YouTube (`nodeIntegrationInSubFrames`). Lá ele controla o `<video>` diretamente (velocidade, seek, loop) e envia o status para a interface via IPC.

## Observações

- Vídeos cujo dono desativou a incorporação não tocam. O app mostra a mensagem e um botão para abrir no YouTube.
- Se `npm start` abrir só um processo Node sem janela, verifique se a variável `ELECTRON_RUN_AS_NODE` está definida no seu terminal e remova-a.
- Com Node 26, o `postinstall` do Electron pode terminar sem extrair o binário (erro "Electron failed to install correctly"). Nesse caso, extraia o zip de `%LOCALAPPDATA%\electron\Cache\...` para `node_modules/electron/dist` e crie `node_modules/electron/path.txt` contendo `electron.exe`.

## Versão web (celular e PC, sem servidor no PC)

Uma versão estática para o navegador, pronta para o Cloudflare Pages. A mesma página detecta o aparelho:

- **Celular** (tela de toque com o lado menor abaixo de 768px): layout para usar **deitado**. O vídeo ocupa a esquerda e a linha do tempo fica embaixo. A barra lateral tem abas (Controles / Trechos / Treino / Ajustes). Tem botão de tela cheia e a tela fica acesa durante o treino.
- **PC** (e tablets): o mesmo layout do app Electron.
- Para forçar um layout, use **Ajustes → Layout** ou abra a página com `?layout=mobile`, `?layout=desktop` ou `?layout=auto`.

```bash
npm run build:web     # gera dist-web/
npm run serve:web     # gera e serve em http://localhost:8788 (mostra o endereço para o celular no mesmo Wi-Fi)
```

### O que funciona na web

| Recurso | YouTube | Arquivo do aparelho (📂 Arquivo) |
|---|---|---|
| Projetos, trechos, treino progressivo, exportar/importar | ✅ | ✅ |
| Loop A-B, pausa entre repetições, arraste no vídeo | ✅ (precisão de ~0,1–0,3 s) | ✅ (preciso) |
| Velocidade | só as que o YouTube oferece (0,25 / 0,5 / 0,75 / 1 / 1,25 / 1,5 / 1,75 / 2) | livre, 25–150%, tom preservado |
| Sem internet | ❌ | ✅ (depois da 1ª visita) |

- **Arquivo do aparelho** é o "offline" da web. Escolha um vídeo ou música (mp4, m4a, mp3, wav…). O arquivo fica guardado no navegador (IndexedDB) e não é enviado a nenhum servidor. Também dá para ligar um arquivo a um projeto do YouTube pelo botão do modo (▶ YouTube / 📂 Arquivo).
- **Não existe na web:** baixar vídeos do YouTube (yt-dlp) e separar a guitarra (Demucs). Os dois precisam do app para PC.
- **Limites do YouTube no navegador:** velocidades arredondadas (o app avisa qual foi usada). Cada volta do loop é um pedido de seek, então a precisão é menor. Com o vídeo pausado, o YouTube pode mostrar a própria interface sobre o vídeo.
- **Celular:** o primeiro play de cada vídeo do YouTube precisa de um toque **no próprio vídeo**. No iPhone, o volume é só o dos botões do aparelho (o controle do app só silencia). O iPhone também não tem tela cheia para sites: use **Compartilhar → Adicionar à Tela de Início** e abra pelo ícone.
- Os dados ficam no navegador de cada aparelho. Para levar projetos do PC para o celular, use **Exportar** / **Importar**. O arquivo de mídia precisa ser escolhido de novo no outro aparelho.

### Publicar no Cloudflare Pages

Pelo terminal (pede login no Cloudflare na primeira vez):

```bash
npm run deploy:web    # = build + npx wrangler pages deploy dist-web --project-name solotracker
```

Ou pelo painel, ligando a um repositório Git:

- Build command: `npm run build:web`
- Build output directory: `dist-web`
- Variável de ambiente: `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (evita baixar o Electron no build)

O arquivo `web/_headers` define a CSP (liberando a API do YouTube e arquivos `blob:`) e o `Referrer-Policy` exigido pelo embed do YouTube. Os arquivos da web ficam em `web/`. O `app.js`, o `timeline.js` e o `styles.css` são os mesmos do app Electron.
