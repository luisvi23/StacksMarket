// src/pages/Admin.js
import React, { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import axios from "../setupAxios";
import { BACKEND_URL } from "../contexts/Bakendurl";
import {
  createMarket,
  pollTx,
  resolveMarket,
  withdrawSurplus,
  getWithdrawableSurplus,
  lockfees,
  setFees,
  setFeeRecipients,
  setProtocolSplit,
  setMaxTrade,
  setMarketCloseTime,
  pauseMarket,
  unpauseMarket,
  setMarketBias,
  resetMarketBias,
  redeem as redeemOnChain,
} from "../contexts/stacks/marketClient";
import {
  createLadderGroup,
  addRung,
  resolveLadderGroup,
  resolveRung,
} from "../contexts/stacks/ladderClient";

import toast from "react-hot-toast";
import { formatStx, stxToUstx } from "../utils/stx";

// --- helpers ---
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const toIntegerInput = (raw) => {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return String(Math.max(0, Math.round(n)));
};

const normalize2 = (a, b) => {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { a: 50, b: 50 };
  if (x < 0 || y < 0) return { a: 50, b: 50 };
  if (x === 0 && y === 0) return { a: 50, b: 50 };
  const sum = x + y;
  return { a: (x / sum) * 100, b: (y / sum) * 100 };
};

const Admin = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [uploadingField, setUploadingField] = useState(null);

  const handleImageUpload = async (fieldName, file) => {
    if (!file) return;
    const data = new FormData();
    data.append("image", file);
    setUploadingField(fieldName);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/uploads/image`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm((prev) => ({ ...prev, [fieldName]: res.data.url }));
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setUploadingField(null);
    }
  };

  // Siempre 2 opciones + probs iniciales
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "Politics",
    subCategory: "All",
    endDate: "",
    image: "",
    option0Text: "Yes",
    option0Image: "",
    option1Text: "No",
    option1Image: "",
    initialYesPct: "50",
    initialNoPct: "50",
    cryptoName: "",
    cryptoLogo: "",
    team1Name: "",
    team1Logo: "",
    team1Odds: "",
    team2Name: "",
    team2Logo: "",
    team2Odds: "",
    matchTime: "",
    sportType: "",
    country: "",
    countryFlag: "",
    candidates: "",
    initialLiquidity: "",
  });

  const { data: stats } = useQuery(["admin-dashboard"], async () => {
    return (await axios.get(`${BACKEND_URL}/api/admin/dashboard`)).data;
  });

  const { data: polls, isLoading } = useQuery(["admin-polls", page], async () => {
    return (
      await axios.get(`${BACKEND_URL}/api/admin/polls?page=${page}&limit=10&marketType=binary`)
    ).data;
  });

  useQuery(["market-status"], async () => {
    return (await axios.get(`${BACKEND_URL}/api/market/status`)).data;
  });

  const { data: withdrawableSurplusByMarket = {} } = useQuery(
    [
      "admin-withdrawable-surplus",
      page,
      (polls?.polls || [])
        .map((p) => `${p.marketId || ""}:${p.isResolved ? 1 : 0}:${p.surplusWithdrawn ? 1 : 0}`)
        .join("|"),
    ],
    async () => {
      const rows = polls?.polls || [];
      const resolvedRows = rows.filter((p) => p.isResolved && p.marketId);
      if (!resolvedRows.length) return {};

      const entries = await Promise.all(
        resolvedRows.map(async (p) => {
          const marketIdNum = Number(p.marketId);
          if (!Number.isFinite(marketIdNum)) return [String(p.marketId), { error: true }];
          try {
            const info = await getWithdrawableSurplus(marketIdNum);
            return [String(p.marketId), info];
          } catch (err) {
            return [String(p.marketId), { error: true, message: err?.message || "fetch failed" }];
          }
        })
      );

      return Object.fromEntries(entries);
    },
    {
      enabled: !!polls?.polls?.length,
      staleTime: 5000,
    }
  );

  const createMutation = useMutation(
    async () => {
      const yRaw = Number(form.initialYesPct);
      const nRaw = Number(form.initialNoPct);

      if (!Number.isFinite(yRaw) || !Number.isFinite(nRaw) || yRaw < 0 || nRaw < 0) {
        throw new Error("Invalid initial probabilities");
      }
      if (yRaw === 0 && nRaw === 0) {
        throw new Error("Initial probabilities cannot both be 0");
      }

      const yn = normalize2(yRaw, nRaw);
      const yesPct = yn.a;
      const noPct = yn.b;

      const optionsList = [
        { text: (form.option0Text || "").trim(), image: (form.option0Image || "").trim() },
        { text: (form.option1Text || "").trim(), image: (form.option1Image || "").trim() },
      ];

      if (!optionsList[0].text || !optionsList[1].text) {
        throw new Error("Both option texts are required");
      }

      const payload = {
        title: form.title,
        description: (form.description || "").trim() || "No description",
        category: form.category,
        subCategory: form.subCategory,
        endDate: form.endDate,
        options: optionsList,
        image: (form.image || "").trim(),
        initialYesPct: form.initialYesPct,
        initialNoPct: form.initialNoPct,
      };

      if (form.category === "Crypto") {
        payload.cryptoName = form.cryptoName;
        payload.cryptoLogo = form.cryptoLogo;
      }

      if (form.category === "Sports") {
        payload.team1 = {
          name: form.team1Name,
          logo: form.team1Logo,
          odds: Number(form.team1Odds) || undefined,
        };
        payload.team2 = {
          name: form.team2Name,
          logo: form.team2Logo,
          odds: Number(form.team2Odds) || undefined,
        };
        payload.matchTime = form.matchTime;
        payload.sportType = form.sportType;
        payload.subCategory = form.sportType || form.subCategory;
      }

      if (form.category === "Elections") {
        payload.country = form.country;
        payload.countryFlag = form.countryFlag;
        payload.candidates = form.candidates
          .split("\n")
          .map((line) => {
            const [name, percentage, image] = line.split("|").map((x) => (x || "").trim());
            if (!name) return null;
            return { name, percentage: Number(percentage) || 0, image };
          })
          .filter(Boolean);
      }

      const marketId = Date.now().toString();

      const initialLiquidityUstx = stxToUstx(form.initialLiquidity);
      if (!Number.isFinite(initialLiquidityUstx) || initialLiquidityUstx <= 0) {
        throw new Error("Please enter a valid initial liquidity in STX (> 0)");
      }
      const initialLiquidity = initialLiquidityUstx;

      const timestampValue = parseInt(marketId, 10);
      if (isNaN(timestampValue) || timestampValue <= 0) {
        throw new Error(`Invalid timestamp-based marketId: ${marketId}`);
      }

      const pendingRes = await axios.post(`${BACKEND_URL}/api/polls/pending`, {
        ...payload,
        marketId,
      });
      const pendingPoll = pendingRes?.data?.poll;
      if (!pendingPoll?._id) {
        throw new Error("Failed to create pending poll");
      }

      const tx = await createMarket(timestampValue, initialLiquidity);
      try {
        await axios.post(
          `${BACKEND_URL}/api/polls/pending/${pendingPoll._id}/txid`,
          { txid: tx.txId, marketId }
        );
      } catch (err) {
        console.warn("Failed to store createTxId:", err);
      }

      let createConfirmed = false;
      try {
        await pollTx(tx.txId);
        createConfirmed = true;
      } catch (err) {
        try {
          const rec = await axios.post(
            `${BACKEND_URL}/api/polls/pending/${pendingPoll._id}/reconcile`
          );
          if (rec?.data?.poll?.creationStatus === "confirmed") {
            createConfirmed = true;
          }
        } catch (reconcileErr) {
          console.warn("Reconcile failed:", reconcileErr);
        }
        if (!createConfirmed) throw err;
      }

      const confirmed = await axios.post(`${BACKEND_URL}/api/polls/confirm`, {
        pendingPollId: pendingPoll._id,
        txid: tx.txId,
        marketId,
      });

      const confirmedPoll = confirmed?.data?.poll || pendingPoll;

      // bias inicial: usa % entero (1..99). v10 lo lockea para pricing-only
      try {
        const pYesInt = Math.round(yesPct);
        const txBias = await setMarketBias(timestampValue, pYesInt);
        await pollTx(txBias.txId);
      } catch (err) {
        toast.error("âŒ Bias tx failed (market already created)");
      }

      if (confirmedPoll?._id) {
        try {
          await axios.patch(`${BACKEND_URL}/api/polls/${confirmedPoll._id}/odds`, {
            yesPct: Math.round(yesPct),
            noPct: Math.round(noPct),
          });
        } catch (err) {
          console.warn("Failed to set initial odds:", err);
        }
      }

      // Auto-set on-chain close time from backend poll endDate (single source of truth).
      try {
        const endDateFromBackend = confirmedPoll?.endDate || pendingPoll?.endDate;
        const endMs = endDateFromBackend ? new Date(endDateFromBackend).getTime() : NaN;
        if (Number.isFinite(endMs)) {
          const closeTimeSec = Math.floor(endMs / 1000);
          const txClose = await setMarketCloseTime(timestampValue, closeTimeSec);
          await pollTx(txClose.txId);
        }
      } catch (err) {
        console.warn("Failed to auto-set close time:", err);
        toast.error("Poll created, but auto close-time failed. Use 'Set Close Time'.");
      }

      return confirmed.data;
    },
    {
      onSuccess: () => {
        setCreating(false);
        setForm({
          title: "",
          description: "",
          category: "Politics",
          subCategory: "All",
          endDate: "",
          image: "",
          option0Text: "Yes",
          option0Image: "",
          option1Text: "No",
          option1Image: "",
          initialYesPct: "50",
          initialNoPct: "50",
          cryptoName: "",
          cryptoLogo: "",
          team1Name: "",
          team1Logo: "",
          team1Odds: "",
          team2Name: "",
          team2Logo: "",
          team2Odds: "",
          matchTime: "",
          sportType: "",
          country: "",
          countryFlag: "",
          candidates: "",
          initialLiquidity: "",
        });
        queryClient.invalidateQueries(["admin-polls"]);
        queryClient.invalidateQueries(["admin-withdrawable-surplus"]);
        toast.success("✅ Poll created");
      },
      onError: (err) => toast.error(err?.message || "❌ Create poll failed"),
    }
  );

  const deleteMutation = useMutation(
    async (id) => (await axios.delete(`${BACKEND_URL}/api/admin/polls/${id}`)).data,
    {
      onSuccess: () => queryClient.invalidateQueries(["admin-polls"]),
      onError: () => toast.error("❌ Delete failed"),
    }
  );

  const [editingPoll, setEditingPoll] = useState(null);
  const [resolvingPoll, setResolvingPoll] = useState(null);
  const [resolveIndex, setResolveIndex] = useState("");
  const [maxTradeModalOpen, setMaxTradeModalOpen] = useState(false);
  const [maxTradeAmount, setMaxTradeAmount] = useState("");
  const [closeTimeModalOpen, setCloseTimeModalOpen] = useState(false);
  const [closeTimeValue, setCloseTimeValue] = useState("");

  const [setFeesModalOpen, setSetFeesModalOpen] = useState(false);
  const [setFeeRecipientsModalOpen, setSetFeeRecipientsModalOpen] = useState(false);
  const [setProtocolSplitModalOpen, setSetProtocolSplitModalOpen] = useState(false);
  const [selectedMarketId, setSelectedMarketId] = useState(null);
  const [feesData, setFeesData] = useState({ protocolBps: "", lpBps: "" });
  const [protocolSplitData, setProtocolSplitData] = useState({ pctA: "", pctB: "" });
  const [feeRecipientsData, setFeeRecipientsData] = useState({
    walletA: "",
    walletB: "",
    lp: "",
  });

  useEffect(() => {
    const handleClickOutside = () => {
      if (selectedMarketId !== null) setSelectedMarketId(null);
    };

    if (selectedMarketId !== null) {
      document.addEventListener("click", handleClickOutside);
    }

    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [selectedMarketId]);

  const updateMutation = useMutation(
    async ({ id, data }) =>
      (await axios.put(`${BACKEND_URL}/api/admin/polls/${id}`, data)).data,
    {
      onSuccess: () => {
        setEditingPoll(null);
        queryClient.invalidateQueries(["admin-polls"]);
        queryClient.invalidateQueries(["admin-withdrawable-surplus"]);
        toast.success("✅ Poll updated");
      },
      onError: (err) => toast.error(err?.message || "❌ Update failed"),
    }
  );

  const resolveMutation = useMutation(
    async ({ id, winningOption }) => {
      const poll = (polls?.polls || []).find((p) => p._id === id);
      if (!poll) throw new Error("Poll not found");
      if (!poll.marketId) throw new Error("Poll missing marketId");
      const marketId = Number(poll.marketId);
      if (!Number.isFinite(marketId)) throw new Error("Invalid marketId");

      const option = poll.options?.[winningOption];
      if (!option) throw new Error("Invalid winning option");

      let result = (option.text || "").toString().toUpperCase().trim();
      if (result !== "YES" && result !== "NO") {
        if (winningOption === 0) result = "YES";
        else if (winningOption === 1) result = "NO";
        else throw new Error("Option text must be YES or NO");
      }

      const tx = await resolveMarket(marketId, result);
      await pollTx(tx.txId);

      const backendRes = await axios.post(`${BACKEND_URL}/api/admin/polls/${id}/resolve`, {
        winningOption,
        txid: tx.txId,
      });

      // ✅ opcional: set odds final para UI inmediato
      try {
        await axios.patch(`${BACKEND_URL}/api/polls/${id}/odds`, {
          yesPct: result === "YES" ? 100 : 0,
          noPct: result === "NO" ? 100 : 0,
        });
      } catch {}

      return backendRes.data;
    },
    {
      onSuccess: () => {
        setResolvingPoll(null);
        queryClient.invalidateQueries(["admin-polls"]);
        queryClient.invalidateQueries(["admin-withdrawable-surplus"]);
        toast.success("✅ Resolved");
      },
      onError: (err) => toast.error(err?.message || "❌ Resolve failed"),
    }
  );

  const resetMarketBiasMutation = useMutation(
    async ({ id }) => {
      const poll = (polls?.polls || []).find((p) => p._id === id);
      if (!poll) throw new Error("Poll not found");
      if (!poll.marketId) throw new Error("Poll missing marketId");
      const marketId = Number(poll.marketId);
      if (!Number.isFinite(marketId)) throw new Error("Invalid marketId");

      const tx = await resetMarketBias(marketId);
      await pollTx(tx.txId);
      return tx;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["admin-polls"]);
        toast.success("✅ Bias reset");
      },
      onError: (err) => toast.error(`❌ Reset bias failed: ${err?.message || err}`),
    }
  );

  const lockFeesMutation = useMutation(
    async () => {
      const tx = await lockfees();
      await pollTx(tx.txId);
      return tx;
    },
    {
      onSuccess: () => toast.success("✅ Fees locked"),
      onError: (err) => toast.error(`❌ Lock fees failed: ${err?.message || err}`),
    }
  );

  const withdrawSurplusMutation = useMutation(
    async ({ id }) => {
      const poll = (polls?.polls || []).find((p) => p._id === id);
      if (!poll) throw new Error("Poll not found");
      if (!poll.marketId) throw new Error("Poll missing marketId");
      const marketId = Number(poll.marketId);
      if (!Number.isFinite(marketId)) throw new Error("Invalid marketId");

      const tx = await withdrawSurplus(marketId);
      await pollTx(tx.txId);

      const res = await axios.post(
        `${BACKEND_URL}/api/admin/polls/${id}/withdraw-surplus`,
        { txid: tx.txId }
      );

      return { tx, backend: res.data };
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["admin-polls"]);
        toast.success("✅ Surplus withdrawn");
      },
      onError: (err) => toast.error(`❌ Withdraw surplus failed: ${err?.message || err}`),
    }
  );

  // ✅ NEW: Redeem on-chain from admin (for testing / if admin holds winning shares)
  const redeemAdminMutation = useMutation(
    async ({ id }) => {
      const poll = (polls?.polls || []).find((p) => p._id === id);
      if (!poll) throw new Error("Poll not found");
      if (!poll.marketId) throw new Error("Poll missing marketId");
      const marketId = Number(poll.marketId);
      if (!Number.isFinite(marketId)) throw new Error("Invalid marketId");

      const tx = await redeemOnChain(marketId);
      await pollTx(tx.txId);

      // opcional: guardar log en backend si tienes endpoint (si no, lo omitimos)
      try {
        await axios.post(`${BACKEND_URL}/api/admin/polls/${id}/redeem-admin`, {
          txid: tx.txId,
        });
      } catch {
        // si no existe endpoint, no pasa nada
      }

      return tx;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries(["admin-polls"]);
        toast.success("✅ Redeem (admin) success");
      },
      onError: (err) => toast.error(`❌ Redeem failed: ${err?.message || err}`),
    }
  );

  const pauseMarketMutation = useMutation(
    async ({ marketId }) => {
      const tx = await pauseMarket(marketId);
      await pollTx(tx.txId);
      await axios.post(`${BACKEND_URL}/api/admin/market/${marketId}/pause`, { txid: tx.txId });
      toast.success("✅ Market paused");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    { onError: (err) => toast.error(`❌ Pause market failed: ${err?.message || err}`) }
  );

  const unpauseMarketMutation = useMutation(
    async ({ marketId }) => {
      const tx = await unpauseMarket(marketId);
      await pollTx(tx.txId);
      await axios.post(`${BACKEND_URL}/api/admin/market/${marketId}/unpause`, { txid: tx.txId });
      toast.success("✅ Market unpaused");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    { onError: (err) => toast.error(`❌ Unpause market failed: ${err?.message || err}`) }
  );

  const setFeesMutation = useMutation(
    async ({ protocolBps, lpBps }) => {
      const tx = await setFees(Number(protocolBps), Number(lpBps));
      await pollTx(tx.txId);
      toast.success("✅ Global fees set");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    { onError: (err) => toast.error(`❌ Set fees failed: ${err?.message || err}`) }
  );

  const setFeeRecipientsMutation = useMutation(
    async ({ walletA, walletB, lp }) => {
      const tx = await setFeeRecipients(walletA, walletB, lp);
      await pollTx(tx.txId);
      toast.success("✅ Global fee recipients set");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    { onError: (err) => toast.error(`❌ Set fee recipients failed: ${err?.message || err}`) }
  );

  const setProtocolSplitMutation = useMutation(
    async ({ pctA, pctB }) => {
      const a = Number(pctA);
      const b = Number(pctB);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a + b !== 100) {
        throw new Error("pct-a + pct-b must equal 100");
      }
      const tx = await setProtocolSplit(a, b);
      await pollTx(tx.txId);
      toast.success("✅ Protocol split updated");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    { onError: (err) => toast.error(`❌ Set protocol split failed: ${err?.message || err}`) }
  );

  const setMaxTradeMutation = useMutation(
    async ({ marketId, limit }) => {
      const marketIdNum = Number(marketId);
      const limitUstx = stxToUstx(limit);

      if (!Number.isFinite(marketIdNum) || !Number.isFinite(limitUstx)) {
        throw new Error(`Invalid marketId or limit: marketId=${marketId}, limit=${limit}`);
      }

      const limitNum = Math.round(limitUstx);
      if (!Number.isFinite(limitNum) || limitNum <= 0) {
        throw new Error("Max trade must be a positive amount (STX)");
      }

      const tx = await setMaxTrade(marketIdNum, limitNum);
      await pollTx(tx.txId);

      await axios.post(`${BACKEND_URL}/api/admin/market/${marketIdNum}/set-max-trade`, {
        limit: limitNum,
        txid: tx.txId,
      });

      toast.success("✅ Max trade set");
      queryClient.invalidateQueries(["admin-polls"]);
    },
    {
      onSuccess: () => {
        setMaxTradeModalOpen(false);
        setMaxTradeAmount("");
        setSelectedMarketId(null);
      },
      onError: (err) => toast.error(`❌ Set max trade failed: ${err?.message || err}`),
    }
  );

  const setCloseTimeMutation = useMutation(
    async ({ marketId, closeTime }) => {
      const marketIdNum = Number(marketId);
      const closeNum = Math.round(Number(closeTime));

      if (!Number.isFinite(marketIdNum)) {
        throw new Error(`Invalid marketId: ${marketId}`);
      }
      if (!Number.isFinite(closeNum) || closeNum < 0) {
        throw new Error("Close time must be 0 or a valid unix timestamp (seconds)");
      }

      const tx = await setMarketCloseTime(marketIdNum, closeNum);
      await pollTx(tx.txId);

      toast.success(closeNum === 0 ? "Close time cleared" : "Close time set");
      return tx;
    },
    {
      onSuccess: () => {
        setCloseTimeModalOpen(false);
        setCloseTimeValue("");
        setSelectedMarketId(null);
      },
      onError: (err) => toast.error(`Set close time failed: ${err?.message || err}`),
    }
  );

  const categories = useMemo(
    () => [
      "Politics",
      "Middle East",
      "Crypto",
      "Tech",
      "Culture",
      "World",
      "Economy",
      "Sports",
      "Elections",
    ],
    []
  );

  // ===== LADDER STATE =====
  const [ladderCreating, setLadderCreating] = useState(false);
  const [ladderResolvingGroupId, setLadderResolvingGroupId] = useState(null);
  // Map of marketId -> "YES" | "NO" — admin's per-rung selection while resolving a group
  const [ladderRungOutcomes, setLadderRungOutcomes] = useState({});
  const [reResolvingGroupId, setReResolvingGroupId] = useState(null);

  const emptyLadderForm = {
    title: "",
    description: "",
    image: "",
    closeDate: "",
    rungs: [{ label: "", initialLiquidity: "", initialYesPct: "50" }],
  };
  const [ladderForm, setLadderForm] = useState(emptyLadderForm);

  const { data: ladderGroupsData, refetch: refetchLadderGroups } = useQuery(
    ["admin-ladder-groups"],
    async () => {
      const res = await axios.get(`${BACKEND_URL}/api/ladder/groups?limit=50`);
      return res.data;
    },
    { staleTime: 30 * 1000 }
  );
  const ladderGroups = ladderGroupsData?.groups || [];

  // Preload withdrawable surplus for each rung in resolved ladder groups
  const { data: ladderSurplusByMarket = {} } = useQuery(
    [
      "admin-ladder-surplus",
      ladderGroups
        .filter((g) => g.status === "resolved")
        .flatMap((g) => (g.rungs || g.polls || []).map((r) => r.marketId))
        .join(","),
    ],
    async () => {
      const resolvedGroups = ladderGroups.filter((g) => g.status === "resolved");
      if (!resolvedGroups.length) return {};
      const allRungs = resolvedGroups.flatMap((g) =>
        (g.rungs || g.polls || []).filter((r) => r.marketId).map((r) => r.marketId)
      );
      if (!allRungs.length) return {};
      const entries = await Promise.all(
        allRungs.map(async (mId) => {
          try {
            const info = await getWithdrawableSurplus(Number(mId));
            return [String(mId), info];
          } catch {
            return [String(mId), { error: true }];
          }
        })
      );
      return Object.fromEntries(entries);
    },
    { enabled: ladderGroups.some((g) => g.status === "resolved"), staleTime: 10_000 }
  );

  // Helper: total surplus for a ladder group
  const getLadderGroupSurplus = (g) => {
    const rungs = g.rungs || g.polls || [];
    let total = 0;
    for (const r of rungs) {
      const info = ladderSurplusByMarket[String(r.marketId)];
      if (info && !info.error) total += Number(info.withdrawable || 0);
    }
    return total;
  };

  const addLadderRung = () => {
    setLadderForm((prev) => ({
      ...prev,
      rungs: [
        ...prev.rungs,
        { label: "", initialLiquidity: "", initialYesPct: "50" },
      ],
    }));
  };

  const updateLadderRung = (index, field, value) => {
    setLadderForm((prev) => {
      const rungs = [...prev.rungs];
      rungs[index] = { ...rungs[index], [field]: value };
      return { ...prev, rungs };
    });
  };

  const removeLadderRung = (index) => {
    setLadderForm((prev) => ({
      ...prev,
      rungs: prev.rungs.filter((_, i) => i !== index),
    }));
  };

  const createLadderMutation = useMutation(
    async () => {
      if (!ladderForm.title.trim()) throw new Error("Title is required");
      if (!ladderForm.closeDate) throw new Error("Close date is required");

      const closeSec = Math.floor(new Date(ladderForm.closeDate).getTime() / 1000);
      if (!Number.isFinite(closeSec)) throw new Error("Invalid close date");

      if (ladderForm.rungs.length === 0) throw new Error("Add at least one option");
      for (const [i, r] of ladderForm.rungs.entries()) {
        const liq = stxToUstx(r.initialLiquidity);
        const pct = Number(r.initialYesPct);
        if (!liq || liq <= 0) throw new Error(`Option ${i + 1}: invalid initial liquidity`);
        if (!r.label.trim()) throw new Error(`Option ${i + 1}: label is required`);
        if (!Number.isFinite(pct) || pct < 1 || pct > 99) throw new Error(`Option ${i + 1}: YES% must be between 1 and 99`);
      }

      // Auto-generate IDs (same pattern as regular markets: Date.now())
      // Group ID = timestamp; Market IDs = timestamp+1, timestamp+2, ...
      const ts = Date.now();
      const g = ts;

      // 1. Create ladder group on-chain — title/description stored off-chain only (same as regular markets)
      const txGroup = await createLadderGroup(g, "", "", closeSec);

      // 2. Register in backend (title and description live here, not on-chain)
      await axios.post(`${BACKEND_URL}/api/ladder/groups`, {
        groupId: g,
        title: ladderForm.title.trim(),
        resolutionSource: ladderForm.description.trim(),
        image: ladderForm.image.trim() || null,
        closeTime: closeSec,
        createTxId: txGroup.txId,
      });

      // Wait for create-ladder-group to confirm before adding rungs —
      // add-rung checks ladder-group-exists on-chain, so the group must be mined first.
      toast.loading("Waiting for group confirmation on-chain...", { id: "ladder-confirm" });
      await pollTx(txGroup.txId);
      toast.dismiss("ladder-confirm");

      // 3. Add each rung on-chain, wait for confirmation, set bias if not 50, then register in backend
      for (const [i, r] of ladderForm.rungs.entries()) {
        const m = ts + i + 1;
        const liq = stxToUstx(r.initialLiquidity);
        const lbl = r.label.trim().slice(0, 50);
        const pct = Math.round(Number(r.initialYesPct));

        const txRung = await addRung(g, m, lbl, liq);

        // Wait for add-rung to confirm before set-market-bias (bias requires market to exist)
        if (pct !== 50) {
          toast.loading(`Waiting for rung ${i + 1} confirmation...`, { id: `rung-confirm-${i}` });
          await pollTx(txRung.txId);
          toast.dismiss(`rung-confirm-${i}`);
          try {
            await setMarketBias(m, pct);
          } catch (err) {
            console.warn(`[Admin] setMarketBias failed for rung ${m}:`, err?.message);
          }
        }

        try {
          await axios.post(`${BACKEND_URL}/api/ladder/groups/${g}/rungs`, {
            marketId: m,
            label: lbl,
            initialLiquidity: liq,
            addTxId: txRung.txId,
            initialYesPct: pct,
          });
        } catch (err) {
          console.warn(`[Admin] Failed to register rung ${m} in backend:`, err?.message);
        }
      }

      return { groupId: g };
    },
    {
      onSuccess: () => {
        setLadderCreating(false);
        setLadderForm(emptyLadderForm);
        refetchLadderGroups();
        toast.success("Categorical market created");
      },
      onError: (err) => toast.error(err?.message || "Failed to create categorical market"),
    }
  );

  const resolveLadderMutation = useMutation(
    async ({ groupId, outcomes }) => {
      const g = Number(groupId);
      if (!Number.isFinite(g) || g <= 0) throw new Error("Invalid group ID");

      const group = ladderGroups.find((gr) => Number(gr.groupId) === g);
      const alreadyResolved = String(group?.status || "").toLowerCase() === "resolved";

      // 1. Resolve group on-chain (skip if already resolved — useful for retrying failed rungs)
      if (!alreadyResolved) {
        const txGroup = await resolveLadderGroup(g);

        toast.loading("Waiting for group resolution on-chain...", { id: "ladder-resolve" });
        await pollTx(txGroup.txId);
        toast.dismiss("ladder-resolve");

        // 2. Notify backend
        await axios.post(`${BACKEND_URL}/api/ladder/groups/${g}/resolve`, {
          txId: txGroup.txId,
        });
      }

      // 3. Resolve each rung on-chain with admin-selected outcome — wallet prompts one after another
      const rungs = group?.rungs || [];
      for (const [i, r] of rungs.entries()) {
        const m = Number(r.marketId);
        if (!Number.isFinite(m) || m <= 0) continue;
        const outcome = outcomes?.[String(m)] || "NO";
        try {
          const txRung = await resolveRung(m, outcome);
          toast.loading(`Option ${i + 1}/${rungs.length} (${outcome}) confirming...`, { id: `rung-resolve-${i}` });
          await pollTx(txRung.txId);
          toast.dismiss(`rung-resolve-${i}`);
        } catch (err) {
          toast.dismiss(`rung-resolve-${i}`);
          if (err?.message === "User cancelled") {
            toast.error("Resolution cancelled — remaining options skipped");
            break; // Stop the chain if user cancels
          }
          // Skip already-resolved rungs silently
          if (err?.message?.includes("abort_by_response")) continue;
          toast.error(`Option ${i + 1} failed: ${err?.message}`);
        }
      }

      return { groupId: g };
    },
    {
      onSuccess: () => {
        setLadderResolvingGroupId(null);
        setLadderRungOutcomes({});
        refetchLadderGroups();
        queryClient.invalidateQueries(["admin-ladder-surplus"]);
        toast.success("Categorical market resolved");
      },
      onError: (err) => toast.error(err?.message || "Failed to resolve categorical market"),
    }
  );

  const toggleVisibilityMutation = useMutation(
    async ({ groupId, isPublic }) => {
      const res = await axios.patch(`${BACKEND_URL}/api/ladder/groups/${groupId}/visibility`, { isPublic });
      return res.data;
    },
    {
      onSuccess: () => refetchLadderGroups(),
      onError: (err) => toast.error(err?.response?.data?.message || "Failed to update visibility"),
    }
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Admin Dashboard
          </h1>
          <button onClick={() => setCreating(true)} className="btn-primary">
            Create Poll
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-500">Users</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {stats?.totalUsers ?? "-"}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-500">Polls</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {stats?.totalPolls ?? "-"}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-500">Active Polls</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {stats?.activePolls ?? "-"}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
            <div className="text-sm text-gray-500">Volume (STX)</div>
            <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {formatStx(stats?.totalVolume || 0)}
            </div>
          </div>
        </div>

        {/* Polls table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">End</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6" colSpan="5">
                      Loading...
                    </td>
                  </tr>
                ) : (
                  (polls?.polls || []).map((p) => (
                    <tr
                      key={p._id}
                      className="border-t border-gray-100 dark:border-gray-700"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">
                        {p.title}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {p.category}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {new Date(p.endDate).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4">{p.isActive ? "Yes" : "No"}</td>

                      <td className="py-2 pr-4 flex gap-2 items-center">
                        <button
                          onClick={() => setEditingPoll(p)}
                          className="btn-outline btn-sm"
                        >
                          Edit
                        </button>

                        {p.isResolved && (
                          <>
                            {/* ✅ NEW: admin redeem (test) */}
                            <button
                              onClick={() => redeemAdminMutation.mutate({ id: p._id })}
                              className={`btn-outline btn-sm ${
                                redeemAdminMutation.isLoading ? "opacity-50 cursor-not-allowed" : ""
                              }`}
                              disabled={redeemAdminMutation.isLoading}
                              title="Redeem from the admin wallet (only works if admin holds winning shares)"
                            >
                              {redeemAdminMutation.isLoading ? "…" : "Redeem (admin)"}
                            </button>

                            <div className="flex flex-col items-start">
                              <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-none mb-1">
                                {(() => {
                                  const info = withdrawableSurplusByMarket[String(p.marketId)];
                                  if (!info) return "Avail: …";
                                  if (info.error) return "Avail: -";
                                  return `Avail: ${formatStx(info.withdrawable || 0)} STX`;
                                })()}
                              </span>
                              <button
                                onClick={() => withdrawSurplusMutation.mutate({ id: p._id })}
                                className={`btn-secondary btn-sm ${
                                  !!p.surplusWithdrawn ||
                                  withdrawSurplusMutation.isLoading ||
                                  (() => {
                                    const info = withdrawableSurplusByMarket[String(p.marketId)];
                                    return !!info && !info.error && Number(info.withdrawable || 0) <= 0;
                                  })()
                                    ? "opacity-50 cursor-not-allowed bg-gray-400 dark:bg-gray-700"
                                    : ""
                                }`}
                                disabled={
                                  !!p.surplusWithdrawn ||
                                  withdrawSurplusMutation.isLoading ||
                                  (() => {
                                    const info = withdrawableSurplusByMarket[String(p.marketId)];
                                    return !!info && !info.error && Number(info.withdrawable || 0) <= 0;
                                  })()
                                }
                                title={(() => {
                                  const info = withdrawableSurplusByMarket[String(p.marketId)];
                                  if (!info || info.error) return "Withdraw surplus";
                                  return `Pool: ${formatStx(info.pool || 0)} STX | Reserve: ${formatStx(
                                    info.reserve || 0
                                  )} STX | Withdrawable: ${formatStx(info.withdrawable || 0)} STX`;
                                })()}
                              >
                                {p.surplusWithdrawn ? "Surplus Withdrawn" : "Withdraw Surplus"}
                              </button>
                            </div>
                          </>
                        )}

                        <button
                          onClick={() => {
                            if (p.isResolved) {
                              toast("❗ Poll has already been resolved", { icon: "⚠️" });
                              return;
                            }
                            setResolvingPoll(p);
                            setResolveIndex("");
                          }}
                          className={`btn-primary btn-sm ${
                            p.isResolved ? "opacity-50 cursor-not-allowed" : ""
                          }`}
                          disabled={p.isResolved}
                        >
                          Resolve
                        </button>

                        {/* 3-dot menu */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMarketId(selectedMarketId === p.marketId ? null : p.marketId);
                            }}
                            className="btn-outline btn-sm px-2"
                          >
                            ⋯
                          </button>
                          {selectedMarketId === p.marketId && (
                            <div
                              className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="py-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const marketId = Number(p.marketId);
                                    if (p.isPaused) {
                                      unpauseMarketMutation.mutate({ marketId });
                                    } else {
                                      pauseMarketMutation.mutate({ marketId });
                                    }
                                    setSelectedMarketId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  {p.isPaused ? "Unpause Market" : "Pause Market"}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSetFeesModalOpen(true);
                                    setSelectedMarketId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Set Global Fees
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSetFeeRecipientsModalOpen(true);
                                    setSelectedMarketId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Set Global Fee Recipients
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSetProtocolSplitModalOpen(true);
                                    setSelectedMarketId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Set Protocol Split (%)
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const marketId = Number(p.marketId);
                                    setMaxTradeAmount("");
                                    setMaxTradeModalOpen(true);
                                    setSelectedMarketId(marketId);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Set Max Trade
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const marketId = Number(p.marketId);
                                    setCloseTimeValue("");
                                    setCloseTimeModalOpen(true);
                                    setSelectedMarketId(marketId);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Set Close Time
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Reset bias for market ${p.marketId}? Only works if no shares have been traded yet.`)) {
                                      resetMarketBiasMutation.mutate({ id: p._id });
                                    }
                                    setSelectedMarketId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  Reset Bias
                                </button>
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => deleteMutation.mutate(p._id)}
                          className="btn-danger btn-sm"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mt-4 gap-2">
            <button
              className="btn-outline btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!polls?.pagination?.hasPrev}
            >
              Prev
            </button>
            <button
              className="btn-outline btn-sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!polls?.pagination?.hasNext}
            >
              Next
            </button>
          </div>
        </div>

        {/* Lock Fees */}
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                ⚠️ Lock Fees Configuration
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300">
                This action is GLOBAL and ONE-TIME ONLY. Once locked, fees cannot be
                changed for any market.
              </p>
            </div>
            <button
              onClick={() => {
                if (window.confirm("⚠️ WARNING: Lock fees globally forever. Are you sure?")) {
                  lockFeesMutation.mutate();
                }
              }}
              className={`btn-danger ${lockFeesMutation.isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
              disabled={lockFeesMutation.isLoading}
            >
              {lockFeesMutation.isLoading ? "Locking..." : "🔒 Lock Fees Globally"}
            </button>
          </div>
        </div>
        {/* ===== CATEGORICAL MARKETS SECTION ===== */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Mercados Categóricos
            </h2>
            <button onClick={() => setLadderCreating(true)} className="btn-primary">
              Crear Mercado Categórico
            </button>
          </div>

          {/* Existing ladder groups table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-2 pr-4">Group ID</th>
                  <th className="py-2 pr-4">Titulo</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Opciones</th>
                  <th className="py-2 pr-4">Público</th>
                  <th className="py-2 pr-4">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ladderGroups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-gray-400 dark:text-gray-500">
                      No hay mercados categóricos registrados.
                    </td>
                  </tr>
                ) : (
                  ladderGroups.map((g) => (
                    <tr
                      key={g._id ?? g.groupId}
                      className="border-t border-gray-100 dark:border-gray-700"
                    >
                      <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 font-mono">
                        {g.groupId}
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {g.title}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            String(g.status || "").toLowerCase() === "resolved"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                          }`}
                        >
                          {g.status || "active"}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-gray-700 dark:text-gray-300">
                        {(g.polls || []).length}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() =>
                            toggleVisibilityMutation.mutate({
                              groupId: g.groupId,
                              isPublic: !g.isPublic,
                            })
                          }
                          disabled={toggleVisibilityMutation.isLoading}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                            g.isPublic ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"
                          }`}
                          title={g.isPublic ? "Visible en sitio público — click para ocultar" : "Oculto — click para publicar"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${
                              g.isPublic ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          {ladderResolvingGroupId === g.groupId ? (
                            (() => {
                              const groupRungs = g.rungs || g.polls || [];
                              const yesCount = groupRungs.filter(
                                (r) => ladderRungOutcomes[String(r.marketId)] === "YES"
                              ).length;
                              return (
                                <div className="flex flex-col gap-2 max-w-md w-full">
                                  <div className="space-y-1.5">
                                    {groupRungs.map((r) => {
                                      const mId = String(r.marketId);
                                      const sel = ladderRungOutcomes[mId] || "NO";
                                      return (
                                        <div
                                          key={mId}
                                          className="flex items-center justify-between gap-2 text-xs"
                                        >
                                          <span className="truncate text-gray-700 dark:text-gray-300">
                                            {r.label || `#${r.marketId}`}
                                          </span>
                                          <div className="inline-flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setLadderRungOutcomes((prev) => ({ ...prev, [mId]: "YES" }))
                                              }
                                              className={`px-2 py-0.5 text-[10px] font-semibold ${
                                                sel === "YES"
                                                  ? "bg-emerald-500 text-white"
                                                  : "bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                              }`}
                                            >
                                              YES
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setLadderRungOutcomes((prev) => ({ ...prev, [mId]: "NO" }))
                                              }
                                              className={`px-2 py-0.5 text-[10px] font-semibold ${
                                                sel === "NO"
                                                  ? "bg-rose-500 text-white"
                                                  : "bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                              }`}
                                            >
                                              NO
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {(yesCount === 0 || yesCount > 1) && (
                                    <p className="text-[10px] text-amber-500">
                                      ⚠️{" "}
                                      {yesCount === 0
                                        ? "Ningún YES seleccionado"
                                        : `${yesCount} opciones marcadas como YES`}
                                    </p>
                                  )}
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() =>
                                        resolveLadderMutation.mutate({
                                          groupId: g.groupId,
                                          outcomes: ladderRungOutcomes,
                                        })
                                      }
                                      disabled={resolveLadderMutation.isLoading}
                                      className="btn-primary btn-sm disabled:opacity-50"
                                    >
                                      {resolveLadderMutation.isLoading
                                        ? "..."
                                        : "Confirmar resolución"}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setLadderResolvingGroupId(null);
                                        setLadderRungOutcomes({});
                                      }}
                                      className="btn-outline btn-sm"
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : String(g.status || "").toLowerCase() !== "resolved" ? (
                            <button
                              onClick={() => {
                                setLadderResolvingGroupId(g.groupId);
                                const init = {};
                                (g.rungs || g.polls || []).forEach((r) => {
                                  init[String(r.marketId)] = "NO";
                                });
                                setLadderRungOutcomes(init);
                              }}
                              className="btn-outline btn-sm"
                            >
                              Resolver
                            </button>
                          ) : (() => {
                            const totalSurplus = getLadderGroupSurplus(g);
                            const allWithdrawn = totalSurplus <= 0;
                            const busy = reResolvingGroupId === g.groupId;
                            return (
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                  Surplus: {formatStx(totalSurplus)} STX
                                </span>
                                <div className="flex items-center gap-2">
                                  {/* Re-resolver opens the per-option YES/NO selection (skips group-level call). */}
                                  <button
                                    disabled={busy}
                                    onClick={() => {
                                      const rungs = g.rungs || g.polls || [];
                                      if (!rungs.length) { toast.error("No options found"); return; }
                                      setLadderResolvingGroupId(g.groupId);
                                      const init = {};
                                      rungs.forEach((r) => {
                                        init[String(r.marketId)] = String(r.outcome || "").toUpperCase() === "YES" ? "YES" : "NO";
                                      });
                                      setLadderRungOutcomes(init);
                                    }}
                                    className="btn-outline btn-sm text-amber-500 border-amber-500 hover:bg-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {busy ? "..." : "Re-resolver"}
                                  </button>
                                  <button
                                    disabled={busy || allWithdrawn}
                                    onClick={async () => {
                                      const rungs = g.rungs || g.polls || [];
                                      const toWithdraw = rungs.filter((r) => {
                                        const info = ladderSurplusByMarket[String(r.marketId)];
                                        return info && !info.error && Number(info.withdrawable || 0) > 0;
                                      });
                                      if (!toWithdraw.length) { toast.error("No surplus"); return; }
                                      setReResolvingGroupId(g.groupId);
                                      try {
                                        for (const [i, r] of toWithdraw.entries()) {
                                          try {
                                            const tx = await withdrawSurplus(Number(r.marketId));
                                            toast.loading(`Withdraw ${i + 1}/${toWithdraw.length}...`, { id: `ws-${i}` });
                                            await pollTx(tx.txId);
                                            toast.dismiss(`ws-${i}`);
                                          } catch (err) {
                                            toast.dismiss(`ws-${i}`);
                                            if (err?.message === "User cancelled") { toast.error("Cancelled"); break; }
                                            if (!err?.message?.includes("abort_by_response")) toast.error(`Failed: ${err?.message}`);
                                          }
                                        }
                                        toast.success("Surplus withdrawn");
                                        refetchLadderGroups();
                                        queryClient.invalidateQueries(["admin-ladder-surplus"]);
                                      } finally { setReResolvingGroupId(null); }
                                    }}
                                    className={`btn-outline btn-sm disabled:opacity-50 disabled:cursor-not-allowed ${allWithdrawn
                                      ? "text-gray-400 border-gray-400"
                                      : "text-emerald-500 border-emerald-500 hover:bg-emerald-500/10"
                                    }`}
                                  >
                                    {allWithdrawn ? "Withdrawn" : "Withdraw"}
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Ladder Group modal */}
        {ladderCreating && (
          <div className="modal-overlay" onClick={() => setLadderCreating(false)}>
            <div
              className="modal-content max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Crear Mercado Categórico
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Fecha de cierre
                    </label>
                    <input
                      className="input w-full"
                      type="datetime-local"
                      value={ladderForm.closeDate}
                      onChange={(e) => setLadderForm({ ...ladderForm, closeDate: e.target.value })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Titulo
                    </label>
                    <input
                      className="input w-full"
                      value={ladderForm.title}
                      onChange={(e) => setLadderForm({ ...ladderForm, title: e.target.value })}
                      placeholder="e.g. Who will win the Champions League?"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Descripción / Fuente de resolución
                    </label>
                    <input
                      className="input w-full"
                      value={ladderForm.description}
                      onChange={(e) => setLadderForm({ ...ladderForm, description: e.target.value })}
                      placeholder="e.g. Official UEFA result on 2026-05-30"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Imagen
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        className="input flex-1"
                        value={ladderForm.image}
                        onChange={(e) => setLadderForm({ ...ladderForm, image: e.target.value })}
                        placeholder="URL or upload"
                      />
                      <label className="btn-outline btn-sm cursor-pointer">
                        {uploadingField === "ladderImage" ? "..." : "Upload"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            setUploadingField("ladderImage");
                            try {
                              const data = new FormData();
                              data.append("image", file);
                              const res = await axios.post(`${BACKEND_URL}/api/uploads/image`, data, {
                                headers: { "Content-Type": "multipart/form-data" },
                              });
                              setLadderForm((prev) => ({ ...prev, image: res.data.url }));
                            } catch (err) {
                              toast.error(err?.response?.data?.message || "Upload failed");
                            } finally {
                              setUploadingField(null);
                            }
                          }}
                        />
                      </label>
                      {ladderForm.image && (
                        <img src={ladderForm.image} alt="preview" className="w-10 h-10 rounded object-cover" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Opciones */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Opciones
                    </h3>
                    <button onClick={addLadderRung} className="btn-outline btn-sm">
                      + Agregar opción
                    </button>
                  </div>

                  <div className="space-y-3">
                    {ladderForm.rungs.map((rung, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-1 md:grid-cols-3 gap-2 p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg"
                      >
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Label
                          </label>
                          <input
                            className="input w-full text-sm"
                            placeholder="e.g. Madrid wins"
                            value={rung.label}
                            onChange={(e) => updateLadderRung(i, "label", e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Liquidez inicial (STX)
                          </label>
                          <input
                            className="input w-full text-sm"
                            type="number"
                            min="0"
                            placeholder="STX"
                            value={rung.initialLiquidity}
                            onChange={(e) => updateLadderRung(i, "initialLiquidity", e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col">
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            % YES inicial
                          </label>
                          <div className="flex gap-1">
                            <input
                              className="input flex-1 text-sm"
                              type="number"
                              min="1"
                              max="99"
                              placeholder="50"
                              value={rung.initialYesPct}
                              onChange={(e) => updateLadderRung(i, "initialYesPct", e.target.value)}
                            />
                            {ladderForm.rungs.length > 1 && (
                              <button
                                onClick={() => removeLadderRung(i)}
                                className="text-rose-500 hover:text-rose-700 px-1 text-lg font-bold"
                                title="Remove option"
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setLadderCreating(false);
                      setLadderForm(emptyLadderForm);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => createLadderMutation.mutate()}
                    disabled={createLadderMutation.isLoading}
                  >
                    {createLadderMutation.isLoading ? "Creando..." : "Crear on-chain"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create modal */}
        {creating && (
          <div className="modal-overlay" onClick={() => setCreating(false)}>
            <div
              className="modal-content max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Create Poll
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Title
                    </label>
                    <input
                      className="input w-full"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Description
                    </label>
                    <textarea
                      className="input w-full h-24"
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Category
                    </label>
                    <select
                      className="input w-full"
                      value={form.category}
                      onChange={(e) =>
                        setForm({ ...form, category: e.target.value })
                      }
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Initial liquidity (STX)
                    </label>
                      <input
                        className="input w-full"
                        value={form.initialLiquidity}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            initialLiquidity: toIntegerInput(e.target.value),
                          })
                        }
                        placeholder="e.g. 10 STX"
                      />
                  </div>

                  {/*  probabilidades iniciales */}
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Initial YES probability (%)
                    </label>
                    <input
                      className="input w-full"
                      value={form.initialYesPct}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          initialYesPct: String(
                            clamp(Number(e.target.value || 0), 0, 100)
                          ),
                        })
                      }
                      placeholder="e.g. 60"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Initial NO probability (%)
                    </label>
                    <input
                      className="input w-full"
                      value={form.initialNoPct}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          initialNoPct: String(
                            clamp(Number(e.target.value || 0), 0, 100)
                          ),
                        })
                      }
                      placeholder="e.g. 40"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Sub-category
                    </label>
                    <input
                      className="input w-full"
                      value={form.subCategory}
                      onChange={(e) =>
                        setForm({ ...form, subCategory: e.target.value })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      End Date
                    </label>
                    <input
                      type="datetime-local"
                      className="input w-full"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    />
                  </div>

                  {/*  Imagen general */}
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Image URL (general)
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="input w-full"
                        value={form.image}
                        onChange={(e) => setForm({ ...form, image: e.target.value })}
                        placeholder="General market image (header/card)"
                      />
                      <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                        {uploadingField === "image" ? "…" : "Upload"}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("image", e.target.files[0])} />
                      </label>
                    </div>
                  </div>

                  {/*  Opción 0 */}
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Option 1 text
                    </label>
                    <input
                      className="input w-full"
                      value={form.option0Text}
                      onChange={(e) =>
                        setForm({ ...form, option0Text: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Option 1 image URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="input w-full"
                        value={form.option0Image}
                        onChange={(e) =>
                          setForm({ ...form, option0Image: e.target.value })
                        }
                        placeholder="https://..."
                      />
                      <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                        {uploadingField === "option0Image" ? "…" : "Upload"}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("option0Image", e.target.files[0])} />
                      </label>
                    </div>
                  </div>

                  {/*  Opción 1 */}
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Option 2 text
                    </label>
                    <input
                      className="input w-full"
                      value={form.option1Text}
                      onChange={(e) =>
                        setForm({ ...form, option1Text: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Option 2 image URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="input w-full"
                        value={form.option1Image}
                        onChange={(e) =>
                          setForm({ ...form, option1Image: e.target.value })
                        }
                        placeholder="https://..."
                      />
                      <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                        {uploadingField === "option1Image" ? "…" : "Upload"}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("option1Image", e.target.files[0])} />
                      </label>
                    </div>
                  </div>

                  {/* Crypto specifics */}
                  {form.category === "Crypto" && (
                    <>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Crypto Name
                        </label>
                        <input
                          className="input w-full"
                          value={form.cryptoName}
                          onChange={(e) =>
                            setForm({ ...form, cryptoName: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Crypto Logo URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            className="input w-full"
                            value={form.cryptoLogo}
                            onChange={(e) =>
                              setForm({ ...form, cryptoLogo: e.target.value })
                            }
                          />
                          <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                            {uploadingField === "cryptoLogo" ? "…" : "Upload"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("cryptoLogo", e.target.files[0])} />
                          </label>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Sports specifics */}
                  {form.category === "Sports" && (
                    <>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 1 Name
                        </label>
                        <input
                          className="input w-full"
                          value={form.team1Name}
                          onChange={(e) =>
                            setForm({ ...form, team1Name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 1 Logo
                        </label>
                        <div className="flex gap-2">
                          <input
                            className="input w-full"
                            value={form.team1Logo}
                            onChange={(e) =>
                              setForm({ ...form, team1Logo: e.target.value })
                            }
                          />
                          <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                            {uploadingField === "team1Logo" ? "…" : "Upload"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("team1Logo", e.target.files[0])} />
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 1 Odds
                        </label>
                        <input
                          className="input w-full"
                          value={form.team1Odds}
                          onChange={(e) =>
                            setForm({ ...form, team1Odds: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 2 Name
                        </label>
                        <input
                          className="input w-full"
                          value={form.team2Name}
                          onChange={(e) =>
                            setForm({ ...form, team2Name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 2 Logo
                        </label>
                        <div className="flex gap-2">
                          <input
                            className="input w-full"
                            value={form.team2Logo}
                            onChange={(e) =>
                              setForm({ ...form, team2Logo: e.target.value })
                            }
                          />
                          <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                            {uploadingField === "team2Logo" ? "…" : "Upload"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("team2Logo", e.target.files[0])} />
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Team 2 Odds
                        </label>
                        <input
                          className="input w-full"
                          value={form.team2Odds}
                          onChange={(e) =>
                            setForm({ ...form, team2Odds: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Match Time
                        </label>
                        <input
                          type="datetime-local"
                          className="input w-full"
                          value={form.matchTime}
                          onChange={(e) =>
                            setForm({ ...form, matchTime: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Sport Type
                        </label>
                        <input
                          className="input w-full"
                          value={form.sportType}
                          onChange={(e) =>
                            setForm({ ...form, sportType: e.target.value })
                          }
                        />
                      </div>
                    </>
                  )}

                  {/* Elections specifics */}
                  {form.category === "Elections" && (
                    <>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Country
                        </label>
                        <input
                          className="input w-full"
                          value={form.country}
                          onChange={(e) =>
                            setForm({ ...form, country: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Country Flag URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            className="input w-full"
                            value={form.countryFlag}
                            onChange={(e) =>
                              setForm({ ...form, countryFlag: e.target.value })
                            }
                          />
                          <label className="btn btn-secondary shrink-0 cursor-pointer flex items-center gap-1 text-sm">
                            {uploadingField === "countryFlag" ? "…" : "Upload"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload("countryFlag", e.target.files[0])} />
                          </label>
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                          Candidates (one per line: name|percentage|image)
                        </label>
                        <textarea
                          className="input w-full h-24"
                          value={form.candidates}
                          onChange={(e) =>
                            setForm({ ...form, candidates: e.target.value })
                          }
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button className="btn-outline" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isLoading}
                  >
                    {createMutation.isLoading ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit modal */}
        {editingPoll && (
          <div className="modal-overlay" onClick={() => setEditingPoll(null)}>
            <div
              className="modal-content max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Edit Poll
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Title
                    </label>
                    <input
                      className="input w-full"
                      value={editingPoll.title || ""}
                      onChange={(e) =>
                        setEditingPoll({ ...editingPoll, title: e.target.value })
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Description
                    </label>
                    <textarea
                      className="input w-full h-24"
                      value={editingPoll.description || ""}
                      onChange={(e) =>
                        setEditingPoll({
                          ...editingPoll,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Enabled
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!editingPoll.enabled}
                        onChange={(e) =>
                          setEditingPoll({
                            ...editingPoll,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Show on public site
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Featured
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!editingPoll.featured}
                        onChange={(e) =>
                          setEditingPoll({
                            ...editingPoll,
                            featured: e.target.checked,
                          })
                        }
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Mark as featured
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Trending
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!editingPoll.trending}
                        onChange={(e) =>
                          setEditingPoll({
                            ...editingPoll,
                            trending: e.target.checked,
                          })
                        }
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Mark as trending
                      </span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Sub-category
                    </label>
                    <input
                      className="input w-full"
                      value={editingPoll.subCategory || ""}
                      onChange={(e) =>
                        setEditingPoll({
                          ...editingPoll,
                          subCategory: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      End Date
                    </label>
                    <input
                      type="datetime-local"
                      className="input w-full"
                      value={
                        editingPoll.endDate
                          ? new Date(editingPoll.endDate).toISOString().slice(0, 16)
                          : ""
                      }
                      onChange={(e) =>
                        setEditingPoll({ ...editingPoll, endDate: e.target.value })
                      }
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Image URL (general)
                    </label>
                    <input
                      className="input w-full"
                      value={editingPoll.image || ""}
                      onChange={(e) =>
                        setEditingPoll({ ...editingPoll, image: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Options editor */}
                <div className="md:col-span-2 mt-4">
                  <label className="block text-sm text-gray-600 dark:text-gray-300 mb-2">
                    Options
                  </label>

                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Tip: odds are stored in <b>impliedProbability</b> (0–100). Percentage
                    is derived/normalized for display.
                  </div>

                  <div className="space-y-2">
                    {(editingPoll.options || []).map((opt, idx) => (
                      <div key={idx} className="grid grid-cols-8 gap-2 items-center">
                        {/* text */}
                        <input
                          className="input col-span-3"
                          value={opt.text || ""}
                          onChange={(e) => {
                            const updated = [...(editingPoll.options || [])];
                            updated[idx] = { ...updated[idx], text: e.target.value };
                            setEditingPoll({ ...editingPoll, options: updated });
                          }}
                        />

                        {/* impliedProbability */}
                        <input
                          className="input col-span-1"
                          type="number"
                          min="0"
                          max="100"
                          value={
                            opt.impliedProbability != null
                              ? Number(opt.impliedProbability)
                              : 0
                          }
                          onChange={(e) => {
                            const v = clamp(Number(e.target.value || 0), 0, 100);
                            const updated = [...(editingPoll.options || [])];
                            updated[idx] = {
                              ...updated[idx],
                              impliedProbability: Math.round(v),
                              // espejo para UI (backend lo normaliza igualmente)
                              percentage: v,
                            };
                            setEditingPoll({ ...editingPoll, options: updated });
                          }}
                          title="Implied probability (0–100)"
                        />

                        <div className="col-span-1 text-[11px] text-gray-400">
                          {Math.round(Number(opt.impliedProbability || 0))}%
                        </div>

                        {/* image */}
                        <input
                          className="input col-span-3"
                          placeholder="Image URL (optional)"
                          value={opt.image || ""}
                          onChange={(e) => {
                            const updated = [...(editingPoll.options || [])];
                            updated[idx] = { ...updated[idx], image: e.target.value };
                            setEditingPoll({ ...editingPoll, options: updated });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button className="btn-outline" onClick={() => setEditingPoll(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() =>
                      updateMutation.mutate({
                        id: editingPoll._id,
                        data: editingPoll,
                      })
                    }
                    disabled={updateMutation.isLoading}
                  >
                    {updateMutation.isLoading ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Resolve modal */}
        {resolvingPoll && (
          <div className="modal-overlay" onClick={() => setResolvingPoll(null)}>
            <div
              className="modal-content max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Resolve Poll
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Select the winning option:
                </p>
                <select
                  className="input w-full"
                  value={resolveIndex}
                  onChange={(e) => setResolveIndex(e.target.value)}
                >
                  <option value="" disabled>
                    -- Select option --
                  </option>
                  {resolvingPoll.options?.map((opt, idx) => (
                    <option key={idx} value={idx}>
                      {opt.text || `Option ${idx}`}
                    </option>
                  ))}
                </select>
                <div className="flex justify-end gap-2 mt-6">
                  <button className="btn-outline" onClick={() => setResolvingPoll(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() =>
                      resolveMutation.mutate({
                        id: resolvingPoll._id,
                        winningOption: Number(resolveIndex),
                      })
                    }
                    disabled={resolveMutation.isLoading || resolveIndex === ""}
                  >
                    {resolveMutation.isLoading ? "Resolving..." : "Resolve"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Set Max Trade modal */}
        {maxTradeModalOpen && (
          <div className="modal-overlay" onClick={() => setMaxTradeModalOpen(false)}>
            <div
              className="modal-content max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Set Max Trade
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Market ID: {selectedMarketId || "Not selected"}
                </p>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                  Limit (STX per tx)
                </label>
                <input
                  className="input w-full"
                  value={maxTradeAmount}
                  onChange={(e) => setMaxTradeAmount(e.target.value)}
                  placeholder="e.g. 25 (STX)"
                />
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setMaxTradeModalOpen(false);
                      setMaxTradeAmount("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      if (selectedMarketId) {
                        setMaxTradeMutation.mutate({
                          marketId: selectedMarketId,
                          limit: maxTradeAmount,
                        });
                      }
                    }}
                    disabled={
                      setMaxTradeMutation.isLoading ||
                      !maxTradeAmount ||
                      !selectedMarketId
                    }
                  >
                    {setMaxTradeMutation.isLoading ? "Setting..." : "Set Max Trade"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Set Close Time modal */}
        {closeTimeModalOpen && (
          <div className="modal-overlay" onClick={() => setCloseTimeModalOpen(false)}>
            <div
              className="modal-content max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Set Close Time
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Market ID: {selectedMarketId || "Not selected"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Trades are rejected on-chain when block timestamp reaches this datetime.
                </p>
                <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                  Close Time (calendar value)
                </label>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={closeTimeValue}
                  onChange={(e) => setCloseTimeValue(e.target.value)}
                />
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    className="btn-outline"
                    onClick={() => {
                      if (selectedMarketId) {
                        setCloseTimeMutation.mutate({
                          marketId: selectedMarketId,
                          closeTime: 0,
                        });
                      }
                    }}
                    disabled={setCloseTimeMutation.isLoading || !selectedMarketId}
                  >
                    Clear
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setCloseTimeModalOpen(false);
                      setCloseTimeValue("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      if (selectedMarketId) {
                        const closeMs = new Date(closeTimeValue).getTime();
                        if (!Number.isFinite(closeMs)) {
                          toast.error("Invalid close datetime");
                          return;
                        }
                        setCloseTimeMutation.mutate({
                          marketId: selectedMarketId,
                          closeTime: Math.floor(closeMs / 1000),
                        });
                      }
                    }}
                    disabled={
                      setCloseTimeMutation.isLoading ||
                      !selectedMarketId ||
                      !closeTimeValue
                    }
                  >
                    {setCloseTimeMutation.isLoading ? "Setting..." : "Set Close Time"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Set Fees modal */}
        {setFeesModalOpen && (
          <div className="modal-overlay" onClick={() => setSetFeesModalOpen(false)}>
            <div
              className="modal-content max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Set Global Fees
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  This will set fees for ALL markets globally. Use with caution!
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      Protocol BPS
                    </label>
                    <input
                      className="input w-full"
                      value={feesData.protocolBps}
                      onChange={(e) =>
                        setFeesData({ ...feesData, protocolBps: e.target.value })
                      }
                      placeholder="Enter protocol BPS (basis points)"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                      LP BPS
                    </label>
                    <input
                      className="input w-full"
                      value={feesData.lpBps}
                      onChange={(e) =>
                        setFeesData({ ...feesData, lpBps: e.target.value })
                      }
                      placeholder="Enter LP BPS (basis points)"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setSetFeesModalOpen(false);
                      setFeesData({ protocolBps: "", lpBps: "" });
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setFeesMutation.mutate({
                        protocolBps: feesData.protocolBps,
                        lpBps: feesData.lpBps,
                      });
                      setSetFeesModalOpen(false);
                      setFeesData({ protocolBps: "", lpBps: "" });
                    }}
                    disabled={
                      setFeesMutation.isLoading ||
                      !feesData.protocolBps ||
                      !feesData.lpBps
                    }
                  >
                    {setFeesMutation.isLoading ? "Setting..." : "Set Global Fees"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Set Fee Recipients modal */}
        {setFeeRecipientsModalOpen && (
          <div
            className="modal-overlay"
            onClick={() => setSetFeeRecipientsModalOpen(false)}
          >
            <div
              className="modal-content max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                  Set Global Fee Recipients
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  This will set fee recipients for ALL markets globally. Use with
                  caution!
                </p>
                <div className="space-y-4">
                  {[
                    { key: "walletA", label: "Team Wallet (Protocol A)" },
                    { key: "walletB", label: "Loyalty Token Wallet (Protocol B)" },
                    { key: "lp",      label: "LP Wallet" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                        {label}
                      </label>
                      <input
                        className="input w-full"
                        value={feeRecipientsData[key]}
                        onChange={(e) =>
                          setFeeRecipientsData({
                            ...feeRecipientsData,
                            [key]: e.target.value,
                          })
                        }
                        placeholder={`Enter ${label} address`}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setSetFeeRecipientsModalOpen(false);
                      setFeeRecipientsData({ walletA: "", walletB: "", lp: "" });
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setFeeRecipientsMutation.mutate({
                        walletA: feeRecipientsData.walletA,
                        walletB: feeRecipientsData.walletB,
                        lp: feeRecipientsData.lp,
                      });
                      setSetFeeRecipientsModalOpen(false);
                      setFeeRecipientsData({ walletA: "", walletB: "", lp: "" });
                    }}
                    disabled={
                      setFeeRecipientsMutation.isLoading ||
                      !feeRecipientsData.walletA ||
                      !feeRecipientsData.walletB ||
                      !feeRecipientsData.lp
                    }
                  >
                    {setFeeRecipientsMutation.isLoading
                      ? "Setting..."
                      : "Set Global Fee Recipients"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Set Protocol Split modal */}
        {setProtocolSplitModalOpen && (
          <div
            className="modal-overlay"
            onClick={() => setSetProtocolSplitModalOpen(false)}
          >
            <div
              className="modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold mb-4">Set Protocol Split (%)</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                pct-a + pct-b must equal 100
              </p>
              {[
                { key: "pctA", label: "Team Wallet % (Protocol A)" },
                { key: "pctB", label: "Loyalty Token Wallet % (Protocol B)" },
              ].map(({ key, label }) => (
                <div key={key} className="mb-3">
                  <label className="block text-sm font-medium mb-1">
                    {label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="input w-full"
                    value={protocolSplitData[key]}
                    onChange={(e) =>
                      setProtocolSplitData({
                        ...protocolSplitData,
                        [key]: e.target.value,
                      })
                    }
                  />
                </div>
              ))}
              <div className="flex gap-2 mt-4">
                <button
                  className="btn-outline"
                  onClick={() => {
                    setSetProtocolSplitModalOpen(false);
                    setProtocolSplitData({ pctA: "", pctB: "" });
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setProtocolSplitMutation.mutate({
                      pctA: protocolSplitData.pctA,
                      pctB: protocolSplitData.pctB,
                    });
                    setSetProtocolSplitModalOpen(false);
                    setProtocolSplitData({ pctA: "", pctB: "" });
                  }}
                  disabled={
                    setProtocolSplitMutation.isLoading ||
                    protocolSplitData.pctA === "" ||
                    protocolSplitData.pctB === "" ||
                    Number(protocolSplitData.pctA) + Number(protocolSplitData.pctB) !== 100
                  }
                >
                  {setProtocolSplitMutation.isLoading
                    ? "Setting..."
                    : "Set Protocol Split"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;




