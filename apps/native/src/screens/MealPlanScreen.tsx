import { useIsFocused, useNavigation } from "@react-navigation/native";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  useGetMealPlans,
  useGetMealPlanEntries,
  useRemoveFromMealPlan,
  useGetShareStatus,
  useGetPendingMealPlanInvitations,
  useAcceptMealPlanInvitation,
  useDeclineMealPlanInvitation,
  useCreateMealPlan,
  useInviteToMealPlan,
  useGetShareableUsers,
  useGetMealPlanInvitationStatus,
  type MealPlanEntry,
} from "@/api/mealPlan";
import { useUser } from "@/api/user";
import { InvitationBanner } from "@/components/InvitationBanner";
import { Ionicons } from "@/components/Ionicons";
import { MealPlanSkeleton } from "@/components/Skeleton";
import { Text } from "@/components/Text";
import { GlassMenu, type GlassMenuItem } from "@/components/glass/GlassMenu";
import {
  AddToDaySheet,
  type AddToDaySheetRef,
} from "@/components/mealPlan/AddToDaySheet";
import { DaySection, type PlannedMeal } from "@/components/mealPlan/DaySection";
import {
  MealPlanPickerSheet,
  type MealPlanPickerSheetRef,
} from "@/components/mealPlan/MealPlanPickerSheet";
import {
  MealPlanShareSheet,
  type MealPlanShareSheetRef,
} from "@/components/mealPlan/MealPlanShareSheet";
import {
  MealTimesSheet,
  type MealTimesSheetRef,
} from "@/components/mealPlan/MealTimesSheet";
import {
  SharedUsersSheet,
  type SharedUsersSheetRef,
} from "@/components/mealPlan/SharedUsersSheet";
import { WeekStrip } from "@/components/mealPlan/WeekStrip";
import {
  addDays,
  formatWeekRange,
  getWeekDays,
  longDayName,
  startOfWeek,
  toDateString,
  type WeekDay,
} from "@/components/mealPlan/week";
import {
  PeopleLine,
  type SharingMember,
} from "@/components/sharing/SharingControls";
import {
  StartSharingSheet,
  type StartSharingSheetRef,
} from "@/components/sharing/StartSharingSheet";
import { inviteAll } from "@/components/sharing/inviteAll";
import { useSelectedMealPlan } from "@/lib/mealPlanPreferences";

// On iOS the title, the sharing button and ••• sit in the tab's native
// navigation bar, as on the shopping list. Android draws the same row itself.
const IS_IOS = Platform.OS === "ios";
const NAV_BAR_HEIGHT = 44;

// How far below a day's top the list can be scrolled and still count as that day.
const ACTIVE_DAY_OFFSET = 48;

const titleCase = (key: string) =>
  key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " ");

export const MealPlanScreen = () => {
  const { theme, rt } = useUnistyles();
  const navigation = useNavigation();

  // Refs
  const scrollRef = useRef<ScrollViewInstance>(null);
  const sectionTops = useRef(new Map<string, number>());
  // Day kept at the top of the list until the user scrolls. Its section's
  // onLayout re-runs whenever days above it grow (meals loading, a banner
  // appearing), and each time we scroll it back to the top.
  const focusDate = useRef<string | null>(toDateString(new Date()));
  // Only scrolls the user makes move the strip's picked day
  const isUserScrolling = useRef(false);

  // Sheet refs
  const addToDaySheetRef = useRef<AddToDaySheetRef>(null);
  const mealTimesSheetRef = useRef<MealTimesSheetRef>(null);
  const shareSheetRef = useRef<MealPlanShareSheetRef>(null);
  const sharedUsersSheetRef = useRef<SharedUsersSheetRef>(null);
  const mealPlanPickerSheetRef = useRef<MealPlanPickerSheetRef>(null);
  const startSharingSheetRef = useRef<StartSharingSheetRef>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Week shown, and the day picked in the strip
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(() =>
    toDateString(new Date()),
  );
  // "Today" moves on if the app stays open past midnight
  const [today, setToday] = useState(() => toDateString(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setToday(toDateString(new Date()));
    });
    return () => sub.remove();
  }, []);
  const days = useMemo(
    () => getWeekDays(weekStart, new Date(`${today}T12:00:00`)),
    [weekStart, today],
  );

  // Reactive meal plan selection from MMKV
  const {
    selectedPlan: storedPlan,
    setSelectedPlan,
    clearSelectedPlan,
  } = useSelectedMealPlan();

  // Queries
  const { data: mealPlans, isLoading: isLoadingPlans } = useGetMealPlans();
  const activePlan = useMemo(() => {
    if (!mealPlans || mealPlans.length === 0) return null;

    // Check if stored plan is still valid
    if (storedPlan !== null) {
      const foundPlan = mealPlans.find((p) => p.id === storedPlan.id);
      if (foundPlan) {
        return foundPlan;
      }
      // Stored plan no longer valid (deleted/unshared), clear it
      clearSelectedPlan();
    }

    // Fall back to default plan or first plan
    const defaultPlan = mealPlans.find((p) => p.isDefault);
    return defaultPlan ?? mealPlans[0];
  }, [mealPlans, storedPlan, clearSelectedPlan]);

  const { data: entries } = useGetMealPlanEntries({
    mealPlanId: activePlan?.id ?? 0,
    startDate: days[0]!.dateString,
    endDate: days[6]!.dateString,
    enabled: !!activePlan,
  });

  // Only the owner can see who's on a plan, and a personal plan has no one
  const { data: shareStatus } = useGetShareStatus({
    mealPlanId: activePlan?.id ?? 0,
    enabled: Boolean(activePlan?.isOwner && !activePlan.isDefault),
  });

  const { data: userData } = useUser();
  const currentUser = userData?.user;

  // Invitation queries
  const { data: pendingInvitations } = useGetPendingMealPlanInvitations();
  const acceptInvitation = useAcceptMealPlanInvitation();
  const declineInvitation = useDeclineMealPlanInvitation();

  // Mutations
  const removeEntry = useRemoveFromMealPlan();

  const mealTimes = useMemo(() => activePlan?.mealTimes ?? [], [activePlan]);

  // Each day's planned meals, in the plan's meal time order
  const mealsByDate = useMemo(() => {
    const order = new Map(mealTimes.map((t, i) => [t.key, i]));
    const names = new Map(mealTimes.map((t) => [t.key, t.name]));
    const map = new Map<string, PlannedMeal[]>();
    entries?.forEach((entry) => {
      const list = map.get(entry.date) ?? [];
      list.push({
        entry,
        label: names.get(entry.mealType) ?? titleCase(entry.mealType),
      });
      map.set(entry.date, list);
    });
    map.forEach((list) =>
      list.sort(
        (a, b) =>
          (order.get(a.entry.mealType) ?? 99) -
          (order.get(b.entry.mealType) ?? 99),
      ),
    );
    return map;
  }, [entries, mealTimes]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>();
    mealsByDate.forEach((list, date) =>
      map.set(
        date,
        list.map((m) => m.entry),
      ),
    );
    return map;
  }, [mealsByDate]);

  const mealCounts = useMemo(() => {
    const counts = new Map<string, number>();
    mealsByDate.forEach((list, date) => counts.set(date, list.length));
    return counts;
  }, [mealsByDate]);

  // ─── Scrolling between days ────────────────────────────────────────────

  const scrollToDate = useCallback((dateString: string, animated = true) => {
    const top = sectionTops.current.get(dateString);
    if (top === undefined) return; // its onLayout scrolls once it's measured
    scrollRef.current?.scrollTo({ y: Math.max(0, top - 8), animated });
  }, []);

  const handleSectionLayout = useCallback(
    (dateString: string, event: LayoutChangeEvent) => {
      sectionTops.current.set(dateString, event.nativeEvent.layout.y);
      if (focusDate.current === dateString && !isUserScrolling.current) {
        requestAnimationFrame(() => scrollToDate(dateString, false));
      }
    },
    [scrollToDate],
  );

  const handleSelectDate = useCallback(
    (dateString: string) => {
      isUserScrolling.current = false;
      focusDate.current = dateString;
      setSelectedDate(dateString);
      scrollToDate(dateString);
    },
    [scrollToDate],
  );

  // Keep the strip in step with the day at the top of the list
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isUserScrolling.current) return;
      const y = event.nativeEvent.contentOffset.y + ACTIVE_DAY_OFFSET;
      let current = days[0]!.dateString;
      for (const day of days) {
        const top = sectionTops.current.get(day.dateString);
        if (top !== undefined && top <= y) current = day.dateString;
      }
      setSelectedDate((prev) => (prev === current ? prev : current));
    },
    [days],
  );

  const handleScrollBeginDrag = useCallback(() => {
    isUserScrolling.current = true;
    focusDate.current = null;
  }, []);

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // With no fling there's no momentum phase to wait for
      if (Math.abs(event.nativeEvent.velocity?.y ?? 0) < 0.01) {
        isUserScrolling.current = false;
      }
    },
    [],
  );

  const handleMomentumScrollEnd = useCallback(() => {
    isUserScrolling.current = false;
  }, []);

  const showWeek = useCallback((start: Date) => {
    const today = new Date();
    const todayString = toDateString(today);
    const week = getWeekDays(start, today);
    const focus = week.some((d) => d.dateString === todayString)
      ? todayString
      : week[0]!.dateString;
    sectionTops.current.clear();
    focusDate.current = focus;
    isUserScrolling.current = false;
    setSelectedDate(focus);
    setWeekStart(start);
  }, []);

  const handlePreviousWeek = useCallback(
    () => showWeek(addDays(weekStart, -7)),
    [showWeek, weekStart],
  );
  const handleNextWeek = useCallback(
    () => showWeek(addDays(weekStart, 7)),
    [showWeek, weekStart],
  );

  // Tapping the Plan tab again returns to today
  const isFocused = useIsFocused();
  useEffect(() => {
    //  @ts-expect-error navigation type
    const unsubscribe = navigation.addListener("tabPress", () => {
      if (!isFocused) return;
      const thisWeek = startOfWeek(new Date());
      if (thisWeek.getTime() === weekStart.getTime()) {
        handleSelectDate(toDateString(new Date()));
      } else {
        showWeek(thisWeek);
      }
    });
    return unsubscribe;
  }, [navigation, isFocused, weekStart, showWeek, handleSelectDate]);

  // ─── Meals ─────────────────────────────────────────────────────────────

  const dayTitle = useCallback(
    (day: WeekDay) => (day.isToday ? "Today" : longDayName(day.date)),
    [],
  );

  const handleAdd = useCallback((day: WeekDay) => {
    addToDaySheetRef.current?.present({
      dateString: day.dateString,
      label: day.isToday
        ? "today"
        : `${longDayName(day.date)} ${day.date.getDate()}`,
    });
  }, []);

  const handleOpenMeal = useCallback(
    (entry: MealPlanEntry) => {
      navigation.navigate("RecipeDetail", { recipeId: entry.recipeId });
    },
    [navigation],
  );

  const handleDeleteMeal = useCallback(
    (entry: MealPlanEntry) => removeEntry.mutate({ entryId: entry.id }),
    [removeEntry],
  );

  const handleOpenMealTimes = useCallback(() => {
    mealTimesSheetRef.current?.present();
  }, []);

  // ─── Sharing ───────────────────────────────────────────────────────────

  // Only the owner of a shared plan can see who's been invited
  const canInvite = Boolean(activePlan?.isOwner);
  const { data: invitations } = useGetMealPlanInvitationStatus({
    mealPlanId: activePlan?.id ?? 0,
    enabled: Boolean(activePlan?.isOwner && !activePlan.isDefault),
  });

  // Everyone on the plan, you first, then anyone invited
  const members = useMemo(() => {
    const users: SharingMember[] = [];
    if (currentUser) {
      users.push({
        id: currentUser.id,
        name: currentUser.name,
        image: currentUser.image,
      });
    }
    // Members only see the owner: the server keeps the rest to the owner
    if (activePlan && !activePlan.isOwner) {
      users.push(activePlan.owner);
    }
    shareStatus?.forEach((status) =>
      users.push({
        id: status.userId,
        name: status.userName,
        image: status.userImage,
      }),
    );
    invitations?.forEach((invite) =>
      users.push({
        id: invite.userId,
        name: invite.userName,
        image: invite.userImage,
        pending: true,
      }),
    );
    return users;
  }, [currentUser, activePlan, shareStatus, invitations]);

  // Your own plan can't be shared, so inviting starts a shared one
  const handleInvite = useCallback(() => {
    if (!activePlan) return;
    if (activePlan.isDefault && activePlan.isOwner) {
      startSharingSheetRef.current?.present();
    } else {
      shareSheetRef.current?.present();
    }
  }, [activePlan]);

  // Who's on it, or the invite sheet while it's just you
  // Owners can see who's on it; members just read the line
  const handlePeoplePress = useCallback(() => {
    if (shareStatus?.length) {
      sharedUsersSheetRef.current?.present();
    } else {
      handleInvite();
    }
  }, [shareStatus, handleInvite]);

  const handleManageSharing = useCallback(() => {
    shareSheetRef.current?.present();
  }, []);

  // Pending plan ID for newly created plans that aren't in the query cache yet
  const [pendingPlanId, setPendingPlanId] = useState<number | null>(null);

  // Once the query refetches and the pending plan appears, select it
  useEffect(() => {
    if (pendingPlanId === null || !mealPlans) return;
    const plan = mealPlans.find((p) => p.id === pendingPlanId);
    if (plan) {
      setSelectedPlan(plan.id, plan.name);
      setPendingPlanId(null);
    }
  }, [pendingPlanId, mealPlans, setSelectedPlan]);

  const handleSelectMealPlan = useCallback(
    (planId: number) => {
      const plan = mealPlans?.find((p) => p.id === planId);
      if (plan) {
        setSelectedPlan(planId, plan.name);
      } else {
        // New plan not in cache yet — wait for query to refetch
        setPendingPlanId(planId);
      }
    },
    [mealPlans, setSelectedPlan],
  );

  const { data: friends, isLoading: isLoadingFriends } = useGetShareableUsers();
  const { mutateAsync: createPlan } = useCreateMealPlan();
  const { mutateAsync: invite } = useInviteToMealPlan({ silent: true });
  const handleStartSharing = useCallback(
    async (name: string, userIds: string[]) => {
      const plan = await createPlan({ name });
      handleSelectMealPlan(plan.id);
      // The plan exists by now, so a failed invite can be retried from it
      await inviteAll(
        userIds,
        (userId) => invite({ mealPlanId: plan.id, userId }),
        friends,
        `"${name}"`,
      );
    },
    [createPlan, invite, handleSelectMealPlan, friends],
  );

  const handleOpenMealPlanPicker = useCallback(() => {
    mealPlanPickerSheetRef.current?.present();
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────

  const planName = activePlan?.name ?? storedPlan?.name ?? "Meal plan";
  // The picked day, or the week's first if it's in another week
  // (read when tapped, so scrolling through the days doesn't rebuild the menu)
  const dayToAdd = useRef(days[0]!);
  dayToAdd.current =
    days.find((d) => d.dateString === selectedDate) ?? days[0]!;

  const titleButton = useMemo(
    () => (
      <Pressable
        style={({ pressed }) => [
          IS_IOS ? styles.barTitle : styles.titleButton,
          pressed && styles.pressed,
        ]}
        onPress={handleOpenMealPlanPicker}
        disabled={isLoadingPlans}
        accessibilityRole="button"
        accessibilityHint="Switch meal plan"
      >
        <Text type="screenTitle" numberOfLines={1} style={styles.title}>
          {planName}
        </Text>
        <Ionicons
          name="chevron-down"
          size={20}
          color={theme.colors.textSecondary}
          style={styles.titleChevron}
        />
      </Pressable>
    ),
    [planName, isLoadingPlans, handleOpenMealPlanPicker, theme],
  );

  // The ••• menu: everything on the plan that isn't sharing
  const menuGroups: GlassMenuItem[][] = useMemo(
    () => [
      [
        ...(canInvite
          ? [
              {
                key: "invite",
                label: "Invite someone",
                icon: "person-add-outline" as const,
                onPress: handleInvite,
              },
            ]
          : []),
        {
          key: "add",
          label: "Add a meal",
          icon: "add",
          onPress: () => handleAdd(dayToAdd.current),
        },
      ],
      [
        {
          key: "times",
          label: "Meal times",
          icon: "time-outline",
          onPress: handleOpenMealTimes,
        },
        {
          key: "plans",
          label: "All plans",
          icon: "albums-outline",
          onPress: handleOpenMealPlanPicker,
        },
      ],
    ],
    [
      canInvite,
      handleInvite,
      handleAdd,
      handleOpenMealTimes,
      handleOpenMealPlanPicker,
    ],
  );

  useLayoutEffect(() => {
    if (!IS_IOS) return;
    const icons: Record<string, string> = {
      "person-add-outline": "person.badge.plus",
      add: "plus",
      "time-outline": "clock",
      "albums-outline": "square.stack",
    };
    navigation.setOptions({
      unstable_headerLeftItems: () => [
        { type: "custom", hidesSharedBackground: true, element: titleButton },
      ],
      unstable_headerRightItems: () => [
        {
          type: "menu",
          label: "Plan options",
          icon: { type: "sfSymbol", name: "ellipsis" },
          menu: {
            items: menuGroups.map((group) => ({
              type: "submenu",
              // An untitled inline section, shown as a divider
              label: "",
              inline: true,
              items: group.map((item) => ({
                type: "action",
                label: item.label,
                icon: {
                  type: "sfSymbol",
                  name: icons[item.icon ?? ""] ?? "circle",
                },
                onPress: item.onPress,
              })),
            })),
          },
        },
      ],
    } as never);
    // Only when what it shows changes, not on every scroll through the days
  }, [navigation, titleButton, menuGroups]);

  // Android has no navigation bar, so the row is drawn here
  const titleRow = IS_IOS ? null : (
    <View style={styles.headerRow}>
      {titleButton}
      <Pressable
        onPress={() => setMenuOpen(true)}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Plan options"
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={22}
          color={theme.colors.text}
        />
      </Pressable>
    </View>
  );

  if (isLoadingPlans) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>{titleRow}</View>
        <MealPlanSkeleton />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {titleRow}

        {activePlan ? (
          <View style={styles.peopleRow}>
            <PeopleLine
              members={members}
              onPress={canInvite ? handlePeoplePress : undefined}
              onInvite={canInvite ? handleInvite : undefined}
            />
          </View>
        ) : null}

        <View style={styles.weekRow}>
          <Text type="headline" style={styles.weekRange}>
            {formatWeekRange(weekStart)}
          </Text>
          <TouchableOpacity
            style={styles.weekArrow}
            onPress={handlePreviousWeek}
            accessibilityLabel="Previous week"
          >
            <Ionicons name="chevron-back" size={20} style={styles.arrowIcon} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.weekArrow}
            onPress={handleNextWeek}
            accessibilityLabel="Next week"
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              style={styles.arrowIcon}
            />
          </TouchableOpacity>
        </View>

        <WeekStrip
          days={days}
          mealCounts={mealCounts}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
      >
        {pendingInvitations?.map((invitation) => (
          <InvitationBanner
            key={invitation.id}
            inviterName={invitation.inviterName}
            inviterImage={invitation.inviterImage}
            resourceName={invitation.mealPlanName}
            onAccept={() =>
              acceptInvitation.mutate({ invitationId: invitation.id })
            }
            onDecline={() =>
              declineInvitation.mutate({ invitationId: invitation.id })
            }
            isAccepting={acceptInvitation.isPending}
            isDeclining={declineInvitation.isPending}
          />
        ))}

        {days.map((day) => (
          <DaySection
            key={day.dateString}
            day={day}
            title={dayTitle(day)}
            meals={mealsByDate.get(day.dateString) ?? []}
            canEdit={!!activePlan}
            onAdd={handleAdd}
            onOpenMeal={handleOpenMeal}
            onDeleteMeal={handleDeleteMeal}
            onLayout={handleSectionLayout}
          />
        ))}
      </ScrollView>

      {/* Sheets */}
      <AddToDaySheet
        ref={addToDaySheetRef}
        mealPlanId={activePlan?.id}
        mealTimes={mealTimes}
        entriesByDate={entriesByDate}
        onEditMealTimes={handleOpenMealTimes}
      />
      <MealTimesSheet
        ref={mealTimesSheetRef}
        mealPlanId={activePlan?.id}
        planName={activePlan?.name}
        mealTimes={mealTimes}
        isShared={!activePlan?.isOwner || (shareStatus?.length ?? 0) > 0}
      />
      <MealPlanShareSheet
        ref={shareSheetRef}
        mealPlanId={activePlan?.id}
        planName={activePlan?.name}
      />
      <SharedUsersSheet
        ref={sharedUsersSheetRef}
        mealPlanId={activePlan?.id}
        planName={activePlan?.name}
        sharedUsers={shareStatus}
        isOwner={activePlan?.isOwner}
        onManageSharing={handleManageSharing}
      />
      <MealPlanPickerSheet
        ref={mealPlanPickerSheetRef}
        activePlanId={activePlan?.id}
        onSelectPlan={handleSelectMealPlan}
      />
      <StartSharingSheet
        ref={startSharingSheetRef}
        title="Plan together"
        note={`A new plan to share. ${planName} stays just yours.`}
        defaultName="Family dinners"
        resourceLabel="plan"
        friends={friends}
        isLoadingFriends={isLoadingFriends}
        onCreate={handleStartSharing}
      />
      {!IS_IOS && (
        <GlassMenu
          visible={menuOpen}
          top={rt.insets.top + 60}
          groups={menuGroups}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingTop: rt.insets.top + (IS_IOS ? NAV_BAR_HEIGHT : 0),
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    minHeight: 52,
  },
  titleButton: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  title: {
    flexShrink: 1,
  },
  titleChevron: {
    marginLeft: 4,
    marginTop: 2,
  },
  barTitle: {
    // Leaves room for ••• on the right
    width: rt.screen.width - 100,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  pressed: {
    opacity: 0.7,
  },
  peopleRow: {
    paddingHorizontal: 8,
    paddingTop: 2,
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.inputBackground,
  },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  weekRange: {
    flex: 1,
    fontFamily: theme.fonts.bold,
  },
  weekArrow: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowIcon: {
    color: theme.colors.primary,
  },
  list: {
    flex: 1,
  },
  listContent: {
    // Enough room for Sunday to scroll up to the top of the list
    paddingBottom: Math.max(rt.insets.bottom + 120, rt.screen.height * 0.6),
  },
}));
