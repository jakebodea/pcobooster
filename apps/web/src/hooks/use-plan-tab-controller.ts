import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  PlanItem,
  PlanItemArrangement,
  PlanItemKey,
  SongCatalogEntry,
  SongOptionSet,
} from "@pcobooster/planning-center-models/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getItemTypeLabel } from "@/components/schedule/plan-tab-helpers";
import type { DraftState } from "@/components/schedule/plan-tab-helpers";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { usePlanItems } from "@/hooks/use-plan-items";
import { createSongOptionsQueryOptions } from "@/hooks/use-song-options";
import { isQueryFresh } from "@/lib/intent-prefetch";
import {
  appendPlanItem,
  applyPlanItemDraft,
  applyPlanItemsOptimisticUpdate,
  collectPlanSongOptionPrefetchIds,
  createOptimisticBasicPlanItem,
  createOptimisticSongPlanItem,
  nextPlanItemSequence,
  planItemDraftChangesItem,
  planItemsHaveSameOrder,
  removePlanItem,
  replacePlanItem,
  replacePlanItemById,
  restorePlanItemsSnapshot,
  settlePlanItemsQuery,
} from "@/lib/plan-items-query-state";
import type { PlanItemsOptimisticSnapshot } from "@/lib/plan-items-query-state";
import { queryKeys } from "@/lib/query-keys";
import { requestScheduler, speculativeQuery } from "@/lib/request-priority";
import { orpc } from "@/orpc-client";

interface UsePlanTabControllerArgs {
  serviceTypeId: string | null;
  planId: string | null;
}

const EMPTY_PLAN_ITEMS: PlanItem[] = [];

const toPlanItemServicePosition = (
  value: string
): "pre" | "during" | "post" | undefined => {
  if (value === "pre" || value === "during" || value === "post") {
    return value;
  }
  return undefined;
};

const toErrorMessage = (error: Error, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const usePlanTabController = ({
  serviceTypeId,
  planId,
}: UsePlanTabControllerArgs) => {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.planItems(serviceTypeId, planId);
  const { data: itemsData, isLoading } = usePlanItems(serviceTypeId, planId);
  const items = itemsData ?? EMPTY_PLAN_ITEMS;

  const planScope = JSON.stringify([serviceTypeId, planId]);
  const [editor, setEditor] = useState<{
    scope: string;
    itemId: string | null;
    pickerOpen: boolean;
  }>({ scope: planScope, itemId: null, pickerOpen: false });
  const editingItemId = editor.scope === planScope ? editor.itemId : null;
  const songPickerOpen = editor.scope === planScope && editor.pickerOpen;
  const setEditingItemId = (itemId: string | null) => {
    setEditor((current) => ({
      scope: planScope,
      itemId,
      pickerOpen: current.scope === planScope && current.pickerOpen,
    }));
  };
  const setSongPickerOpen = (pickerOpen: boolean) => {
    setEditor((current) => ({
      scope: planScope,
      pickerOpen,
      itemId: current.scope === planScope ? current.itemId : null,
    }));
  };
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingSongId, setPendingSongId] = useState<string | null>(null);

  const prefetchSongOptions = useCallback(
    async (songId: string) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return;
      }
      try {
        await queryClient.query(
          speculativeQuery(createSongOptionsQueryOptions(songId, serviceTypeId))
        );
      } catch {
        // Interactive song queries surface failures; prefetching is best effort.
      }
    },
    [queryClient, serviceTypeId]
  );

  // The plan's songs' keys and arrangements (about 3 Planning Center requests each) load
  // one song at a time in the speculative lane, after the run sheet itself.
  useEffect(() => {
    const songIds = isNonEmptyString(serviceTypeId)
      ? collectPlanSongOptionPrefetchIds(items)
      : [];
    const leave = new AbortController();
    for (const songId of songIds) {
      void requestScheduler.runSpeculative(async () => {
        await prefetchSongOptions(songId);
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [items, prefetchSongOptions, serviceTypeId]);

  const settlePlanItems = () => {
    settlePlanItemsQuery(queryClient, queryKey);
  };

  const itemSongId = useCallback(
    (itemId: string) =>
      items.find((candidate) => candidate.id === itemId)?.song?.id ?? null,
    [items]
  );
  const { getIntentProps: getItemIntentProps } = useIntentPrefetch<string>({
    keyOf: (itemId) => itemId,
    isFresh: (itemId) => {
      const songId = itemSongId(itemId);
      if (songId === null || !isNonEmptyString(serviceTypeId)) {
        return true;
      }
      const options = createSongOptionsQueryOptions(songId, serviceTypeId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (itemId) => {
      const songId = itemSongId(itemId);
      if (songId !== null) {
        await prefetchSongOptions(songId);
      }
    },
  });

  const createItemMutation = useMutation<
    PlanItem,
    Error,
    "header" | "item",
    {
      snapshot: PlanItemsOptimisticSnapshot | undefined;
      optimisticItemId: string;
    }
  >({
    mutationFn: async (kind: "header" | "item") => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      return await orpc.planItems.create({
        serviceTypeId,
        planId,
        itemType: kind,
        title: kind === "header" ? "New Header" : "New Item",
      });
    },
    onMutate: async (kind) => {
      await queryClient.cancelQueries({ queryKey });

      const optimisticItemId = `optimistic-${kind}-${crypto.randomUUID()}`;
      setPendingItemId(optimisticItemId);

      return {
        optimisticItemId,
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            appendPlanItem(
              current,
              createOptimisticBasicPlanItem(
                optimisticItemId,
                kind,
                nextPlanItemSequence(current)
              )
            )
        ),
      };
    },
    onSuccess: (item, _kind, context) => {
      queryClient.setQueryData<PlanItem[]>(
        queryKey,
        (current = EMPTY_PLAN_ITEMS) =>
          replacePlanItemById(current, context.optimisticItemId, item)
      );
      setEditingItemId(item.id);
      toast.success(`${getItemTypeLabel(item)} added.`);
    },
    onError: (error, _kind, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: () => {
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const addSongMutation = useMutation<
    PlanItem,
    Error,
    SongCatalogEntry,
    {
      snapshot: PlanItemsOptimisticSnapshot | undefined;
      optimisticItemId: string;
    }
  >({
    mutationFn: async (song: SongCatalogEntry) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      const songOptionsQuery = createSongOptionsQueryOptions(
        song.id,
        serviceTypeId
      );
      const songOptions =
        queryClient.getQueryData<SongOptionSet | null>(
          songOptionsQuery.queryKey
        ) ?? null;

      return await orpc.planItems.create({
        serviceTypeId,
        planId,
        title: songOptions?.song.title ?? song.title,
        songId: song.id,
        arrangementId: songOptions?.suggestedArrangementId ?? undefined,
        keyId: songOptions?.suggestedKeyId ?? undefined,
        selectedLayoutId: songOptions?.suggestedLayoutId ?? undefined,
      });
    },
    onMutate: async (song) => {
      await queryClient.cancelQueries({ queryKey });

      const optimisticItemId = `optimistic-song-${song.id}-${crypto.randomUUID()}`;
      setPendingSongId(song.id);
      setPendingItemId(optimisticItemId);
      setSongPickerOpen(false);

      return {
        optimisticItemId,
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            appendPlanItem(
              current,
              createOptimisticSongPlanItem(
                optimisticItemId,
                song,
                nextPlanItemSequence(current)
              )
            )
        ),
      };
    },
    onSuccess: (item, _song, context) => {
      queryClient.setQueryData<PlanItem[]>(
        queryKey,
        (current = EMPTY_PLAN_ITEMS) =>
          replacePlanItemById(current, context.optimisticItemId, item)
      );
      setEditingItemId(item.id);
      toast.success("Song added to plan.");
    },
    onError: (error, _song, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: () => {
      setPendingSongId(null);
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const deleteItemMutation = useMutation<
    undefined,
    Error,
    string,
    { snapshot: PlanItemsOptimisticSnapshot | undefined; deletedItemId: string }
  >({
    mutationFn: async (itemId) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      await orpc.planItems.delete({ itemId, serviceTypeId, planId });
    },
    onMutate: async (itemId) => {
      setPendingItemId(itemId);
      await queryClient.cancelQueries({ queryKey });

      return {
        deletedItemId: itemId,
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) => removePlanItem(current, itemId)
        ),
      };
    },
    onError: (error, _itemId, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSuccess: (_result, itemId) => {
      if (editingItemId === itemId) {
        setEditingItemId(null);
      }
      toast.success("Item removed.");
    },
    onSettled: () => {
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const reorderItemsMutation = useMutation<
    undefined,
    Error,
    PlanItem[],
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationFn: async (nextItems) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      await orpc.planItems.reorder({
        serviceTypeId,
        planId,
        sequence: nextItems.map((item) => item.id),
      });
    },
    onMutate: async (nextItems) => {
      setPendingItemId("reorder");
      await queryClient.cancelQueries({ queryKey });

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          () => nextItems
        ),
      };
    },
    onError: (error, _nextItems, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSuccess: () => {
      toast.success("Plan order saved.");
    },
    onSettled: () => {
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const updateItemMutation = useMutation<
    PlanItem,
    Error,
    {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    },
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationFn: async ({
      item,
      draft,
      length,
      optimisticArrangement: _optimisticArrangement,
      optimisticKey: _optimisticKey,
    }: {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    }) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      return await orpc.planItems.update({
        itemId: item.id,
        serviceTypeId,
        planId,
        title: item.song ? item.title : draft.title,
        servicePosition: toPlanItemServicePosition(draft.servicePosition),
        length:
          length !== null && length !== 0 && !Number.isNaN(length) && length > 0
            ? length
            : null,
        description: draft.description,
        songId: undefined,
        arrangementId: draft.arrangementId || undefined,
        keyId: draft.keyId || undefined,
      });
    },
    onMutate: async ({
      item,
      draft,
      length,
      optimisticArrangement,
      optimisticKey,
    }) => {
      setPendingItemId(item.id);
      await queryClient.cancelQueries({ queryKey });

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            replacePlanItem(
              current,
              applyPlanItemDraft(
                item,
                draft,
                length,
                optimisticArrangement,
                optimisticKey
              )
            )
        ),
      };
    },
    onError: (error, _input, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<PlanItem[]>(
        queryKey,
        (current = EMPTY_PLAN_ITEMS) => replacePlanItem(current, updatedItem)
      );
    },
    onSettled: () => {
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  return {
    items,
    isLoading,
    editingItemId,
    editingItem: isNonEmptyString(editingItemId)
      ? (items.find((item) => item.id === editingItemId) ?? null)
      : null,
    songPickerOpen,
    pendingItemId,
    pendingSongId,
    isCreatingBasicItem: createItemMutation.isPending,
    isSavingItem: updateItemMutation.isPending,
    setEditingItemId,
    setSongPickerOpen,
    createBasicItem: async (kind: "header" | "item") =>
      await createItemMutation.mutateAsync(kind),
    addSongToPlan: async (song: SongCatalogEntry) =>
      await addSongMutation.mutateAsync(song),
    deleteItem: async (itemId: string) => {
      await deleteItemMutation.mutateAsync(itemId);
    },
    reorderItems: async (nextItems: PlanItem[]) => {
      if (planItemsHaveSameOrder(items, nextItems)) {
        return;
      }

      await reorderItemsMutation.mutateAsync(nextItems);
    },
    getItemIntentProps,
    saveItem: async (input: {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    }) => {
      if (!planItemDraftChangesItem(input.item, input.draft, input.length)) {
        return;
      }

      await updateItemMutation.mutateAsync(input);
    },
  };
};
