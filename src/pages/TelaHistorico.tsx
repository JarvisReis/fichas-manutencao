import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { db } from "../lib/db";
import { getFicha } from "../config/fichas";
import { avaliarItem, valorExibido } from "../lib/conformidade";
import { excluirExecucaoNoServidor, obterEndpointAdmin } from "../lib/sync";
import { podeEditarExecucao, tempoRestanteJanela } from "../lib/permissoes";
import { normalizar } from "../lib/cadastros";
import type { Sessao } from "../lib/sessao";

interface Props {
  /** só administrador apaga uma execução salva */
  podeExcluir: boolean;
  /** quem está no aparelho — define a janela de correção da ficha concluída */
  sessao: Sessao | null;
  onVoltar: () => void;
  onAbrir: (id: string) => void;
}

export default function TelaHistorico({
  podeExcluir,
  sessao,
  onVoltar,
  onAbrir,
}: Props) {
  const execucoes = useLiveQuery(
    () => db.execucoes.orderBy("atualizadaEm").reverse().toArray(),
    [],
    [],
  );

  const [busca, setBusca] = useState("");

  const [confirmando, setConfirmando] = useState<{
    id: string;
    codigo: string;
  } | null>(null);

  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(
    null,
  );
  // Depois do toque, o botão desabilita: sem isso, toque duplo dispara duas
  // exclusões e a segunda volta com erro, parecendo que nada foi apagado.
  const [excluindo, setExcluindo] = useState(false);

  /**
   * A exclusão é de administrador: o aparelho apaga a cópia local e o serviço de
   * administração apaga a linha no SharePoint. Sem servidor configurado, apaga
   * só aqui e avisa — apagar no SharePoint exige a senha guardada lá.
   */
  const excluir = async (id: string) => {
    if (excluindo) return;
    setExcluindo(true);
    try {
      const endpoint = obterEndpointAdmin();
      if (endpoint) {
        const r = await excluirExecucaoNoServidor(endpoint, id);
        if (!r.ok) {
          setConfirmando(null);
          setAviso({
            erro: true,
            texto: `Não foi possível excluir no servidor: ${r.erro}`,
          });
          return;
        }
      }

      // A cópia local some mesmo sem servidor — senão o item fica na tela para
      // sempre depois de o administrador confirmar a exclusão.
      const fotos = await db.fotos.where("execucaoId").equals(id).toArray();
      for (const f of fotos) await db.fotos.delete(f.id);
      await db.execucoes.delete(id);
      setConfirmando(null);
      setAviso({
        erro: false,
        texto: endpoint
          ? "Execução excluída no aparelho e no SharePoint."
          : "Execução excluída deste aparelho. Sem serviço de administração, a linha do SharePoint (se existir) não é tocada.",
      });
    } finally {
      setExcluindo(false);
    }
  };

  /*
   * Mesmo filtro da home: termo livre sobre equipamento, local, identificação e
   * ficha. A busca é por palavra — "ct 02 11" acha a ficha do CT 02 em novembro.
   */
  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    const lista = execucoes ?? [];
    if (!termo) return lista;
    const partes = termo.split(/\s+/);
    return lista.filter((exec) => {
      const ficha = getFicha(exec.fichaId);
      const alvo = normalizar(
        [
          exec.camposFixos.equipamento ?? "",
          exec.local,
          exec.codigo,
          ficha?.nomeCurto ?? "",
          exec.tipoManutencao ?? "",
        ].join(" "),
      );
      return partes.every((parte) => alvo.includes(parte));
    });
  }, [execucoes, busca]);

  return (
    <div className="min-h-full pb-10">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="rounded-xl p-2 text-slate-600 active:bg-slate-100"
            aria-label="Voltar"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Histórico</p>
            <p className="text-xs text-slate-500">
              {execucoes?.length ?? 0} execução(ões) neste aparelho
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por equipamento, local, ficha ou identificação"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
            >
              <X size={16} className="text-slate-400" />
            </button>
          )}
        </div>

        {aviso && (
          <div
            className={`flex items-start gap-2 rounded-xl border-2 p-3 text-[11px] font-medium ${
              aviso.erro
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-emerald-300 bg-emerald-50 text-emerald-900"
            }`}
          >
            <span className="flex-1">{aviso.texto}</span>
            <button onClick={() => setAviso(null)} aria-label="Fechar aviso">
              <X size={14} />
            </button>
          </div>
        )}
        {execucoes?.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Nenhuma execução registrada ainda.
          </p>
        )}

        {execucoes && execucoes.length > 0 && filtradas.length === 0 && (
          <p className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
            Nenhuma execução encontrada para "{busca}".
          </p>
        )}

        {filtradas.map((exec) => {
          const ficha = getFicha(exec.fichaId);
          const fora = ficha
            ? ficha.itens.filter(
                (item) =>
                  avaliarItem(
                    item,
                    exec.valores.find((v) => v.itemId === item.id)?.valor ?? "",
                    exec.marca,
                  ).resultado === "nao_conforme",
              ).length
            : 0;
          const preenchidos = exec.valores.filter((v) => v.valor !== "").length;

          return (
            <div
              key={exec.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {exec.codigo}
                  </p>
                  <p className="text-xs text-slate-500">
                    {ficha?.nomeCurto ?? exec.fichaId} ·{" "}
                    {exec.local || "sem local"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(exec.dataHora).toLocaleString("pt-BR")}
                  </p>
                </div>
                {podeExcluir && (
                  <button
                    onClick={() =>
                      setConfirmando({ id: exec.id, codigo: exec.codigo })
                    }
                    className="rounded-lg p-2 text-red-600 active:bg-red-50"
                    aria-label="Excluir execução"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                  {preenchidos}/{ficha?.itens.length ?? 0} medidos
                </span>
                {fora > 0 && (
                  <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
                    {fora} fora do limite
                  </span>
                )}
                {exec.status === "concluida" ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
                    <CheckCircle2 size={11} /> concluída
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
                    <Clock size={11} /> rascunho
                  </span>
                )}
                {!exec.sincronizada && (
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">
                    pendente de envio
                  </span>
                )}
              </div>

              {ficha && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-blue-700">
                    Ver medições
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {ficha.itens.map((item) => {
                      const bruto =
                        exec.valores.find((v) => v.itemId === item.id)?.valor ??
                        "";
                      const analise = avaliarItem(item, bruto, exec.marca);
                      const cor =
                        analise.resultado === "conforme"
                          ? "text-emerald-700"
                          : analise.resultado === "nao_conforme"
                            ? "text-red-700"
                            : "text-slate-500";
                      return (
                        <li
                          key={item.id}
                          className="flex justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-slate-600">
                            {item.nome}
                          </span>
                          <span className={`shrink-0 font-bold ${cor}`}>
                            {valorExibido(item, bruto)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}

              {(() => {
                const concluida = exec.status === "concluida";
                const permissao = podeEditarExecucao(
                  exec,
                  sessao,
                  exec.criadaPor,
                );
                if (!permissao.pode) {
                  return (
                    <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-center text-[11px] font-medium text-slate-600">
                      Concluída — a janela de correção fechou. Só administrador
                      reabre.
                    </p>
                  );
                }
                const resta = concluida ? tempoRestanteJanela(exec) : "";
                return (
                  <>
                    <button
                      onClick={() => onAbrir(exec.id)}
                      className="mt-3 w-full rounded-xl border-2 border-slate-300 py-2.5 text-xs font-semibold text-slate-700 active:bg-slate-100"
                    >
                      {permissao.motivo === "administrador"
                        ? "Reabrir e corrigir"
                        : "Abrir e editar"}
                    </button>
                    {resta && (
                      <p className="mt-1 text-center text-[10px] text-slate-500">
                        Sua janela de correção fecha em {resta}.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          );
        })}
      </div>

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-slate-900">
              Excluir execução?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              A ficha <strong>{confirmando.codigo}</strong> será apagada deste
              aparelho, incluindo as fotos. Não há como desfazer.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirmando(null)}
                className="flex-1 rounded-xl border-2 border-slate-300 py-3 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => void excluir(confirmando.id)}
                disabled={excluindo}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                {excluindo ? "Excluindo…" : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
