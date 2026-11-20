"""
Separa a guitarra do áudio de um vídeo baixado (SoloTracker, modo offline).

Uso: python separate.py --input <video.mp4> --outdir <pasta>

Grava na pasta:
  guitar.flac   -> só a guitarra
  backing.flac  -> todo o resto (bateria, baixo, voz, piano, outros)

Saída para o app (stdout): linhas "STAGE <texto>". As barras de progresso do
Demucs/tqdm vão para o stderr e o app lê a porcentagem delas.
"""
import argparse
import os
import sys
import types

SR = 44100


def stage(msg):
    print(f"STAGE {msg}", flush=True)


def load_audio(path):
    """Decodifica o áudio do vídeo com o PyAV (que já traz o FFmpeg) em estéreo 44,1 kHz."""
    import av
    import numpy as np

    with av.open(path) as container:
        if not container.streams.audio:
            raise RuntimeError("O vídeo baixado não tem trilha de áudio.")
        stream = container.streams.audio[0]
        stream.thread_type = "AUTO"
        resampler = av.AudioResampler(format="fltp", layout="stereo", rate=SR)
        chunks = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray())
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray())
    if not chunks:
        raise RuntimeError("Não foi possível ler o áudio do vídeo.")
    return np.concatenate(chunks, axis=1).astype("float32")  # (2, amostras)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--model", default="htdemucs_6s")
    args = parser.parse_args()

    # O Demucs importa o lameenc (só usado para exportar MP3). Se não estiver instalado, um módulo vazio basta.
    try:
        import lameenc  # noqa: F401
    except ImportError:
        sys.modules["lameenc"] = types.ModuleType("lameenc")

    stage("Lendo o áudio do vídeo…")
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    audio = load_audio(args.input)

    stage("Carregando o modelo de separação…")
    model = get_model(args.model)
    model.eval()
    if "guitar" not in model.sources:
        raise RuntimeError(f"O modelo {args.model} não separa guitarra.")
    if model.samplerate != SR:
        raise RuntimeError(f"Taxa de amostragem inesperada do modelo: {model.samplerate}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    wav = torch.from_numpy(audio)
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std

    stage("Separando a guitarra (pode levar alguns minutos)…")
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=True)[0]
    sources = sources * std + mean

    stage("Salvando as trilhas…")
    gi = model.sources.index("guitar")
    guitar = sources[gi]
    backing = sources.sum(0) - guitar

    os.makedirs(args.outdir, exist_ok=True)
    for name, data in (("guitar", guitar), ("backing", backing)):
        arr = np.clip(data.cpu().numpy().T, -1.0, 1.0)  # (amostras, 2)
        sf.write(os.path.join(args.outdir, f"{name}.flac"), arr, SR, format="FLAC", subtype="PCM_16")

    stage("Pronto")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # mensagem curta para o app mostrar
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
