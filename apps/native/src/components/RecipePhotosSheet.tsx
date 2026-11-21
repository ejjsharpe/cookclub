import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import { Image } from "expo-image";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { scheduleOnRN } from "react-native-worklets";

import { AppSheet } from "@/components/AppSheet";
import { Ionicons } from "@/components/Ionicons";
import { Text } from "@/components/Text";

const COLUMNS = 2;
const GAP = 12;
const SIDE_PADDING = 20;
const LONG_PRESS_MS = 180;
const SPRING = { damping: 22, stiffness: 260, mass: 0.7 };

export interface RecipePhotosSheetRef {
  present: () => void;
  dismiss: () => void;
}

export interface RecipePhotoItem {
  id: string;
  uri: string | null;
  isUploading?: boolean;
}

interface RecipePhotosSheetProps {
  photos: RecipePhotoItem[];
  /** The photos' ids in their new order. */
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onAddPhoto: () => void;
  onCreateWithAI: () => void;
  isCreatingWithAI: boolean;
}

type Positions = Record<string, number>;

function positionsFrom(photos: RecipePhotoItem[]): Positions {
  return Object.fromEntries(photos.map((photo, index) => [photo.id, index]));
}

function slotOffset(index: number, tileSize: number) {
  "worklet";
  return {
    x: (index % COLUMNS) * (tileSize + GAP),
    y: Math.floor(index / COLUMNS) * (tileSize + GAP),
  };
}

/**
 * Moves one photo to `to` and shifts the ones in between, like lifting a
 * photo out of the row and dropping it somewhere else.
 */
function movePosition(positions: Positions, id: string, to: number) {
  "worklet";
  const from = positions[id];
  if (from === undefined || from === to) return positions;

  const next: Positions = {};
  for (const key of Object.keys(positions)) {
    const index = positions[key]!;
    if (key === id) {
      next[key] = to;
    } else if (from < to && index > from && index <= to) {
      next[key] = index - 1;
    } else if (from > to && index >= to && index < from) {
      next[key] = index + 1;
    } else {
      next[key] = index;
    }
  }
  return next;
}

interface PhotoTileProps {
  photo: RecipePhotoItem;
  index: number;
  count: number;
  tileSize: number;
  positions: SharedValue<Positions>;
  onDragChange: (dragging: boolean) => void;
  onDrop: () => void;
  onMove: (id: string, to: number) => void;
  onRemove: (id: string) => void;
}

const PhotoTile = ({
  photo,
  index,
  count,
  tileSize,
  positions,
  onDragChange,
  onDrop,
  onMove,
  onRemove,
}: PhotoTileProps) => {
  const start = slotOffset(index, tileSize);
  const x = useSharedValue(start.x);
  const y = useSharedValue(start.y);
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const rows = Math.ceil(count / COLUMNS);

  // Slide into a new slot whenever another photo is dragged past this one.
  useAnimatedReaction(
    () => positions.get()[photo.id],
    (slot) => {
      if (slot === undefined || isDragging.get()) return;
      const target = slotOffset(slot, tileSize);
      x.set(withSpring(target.x, SPRING));
      y.set(withSpring(target.y, SPRING));
    },
  );

  const pan = usePanGesture({
    activateAfterLongPress: LONG_PRESS_MS,
    onActivate: () => {
      "worklet";
      isDragging.set(true);
      dragStartX.set(x.get());
      dragStartY.set(y.get());
      scheduleOnRN(onDragChange, true);
    },
    onUpdate: (event) => {
      "worklet";
      x.set(dragStartX.get() + event.translationX);
      y.set(dragStartY.get() + event.translationY);

      const step = tileSize + GAP;
      const column = Math.min(
        COLUMNS - 1,
        Math.max(0, Math.round(x.get() / step)),
      );
      const row = Math.min(rows - 1, Math.max(0, Math.round(y.get() / step)));
      const to = Math.min(count - 1, row * COLUMNS + column);
      const current = positions.get();
      if (current[photo.id] !== to) {
        positions.set(movePosition(current, photo.id, to));
      }
    },
    onDeactivate: () => {
      "worklet";
      const target = slotOffset(positions.get()[photo.id] ?? 0, tileSize);
      x.set(withSpring(target.x, SPRING));
      y.set(withSpring(target.y, SPRING));
      scheduleOnRN(onDrop);
    },
    onFinalize: () => {
      "worklet";
      if (!isDragging.get()) return;
      isDragging.set(false);
      scheduleOnRN(onDragChange, false);
    },
  });

  const animatedStyle = useAnimatedStyle(() => {
    const dragging = isDragging.get();
    return {
      transform: [
        { translateX: x.get() },
        { translateY: y.get() },
        { scale: withSpring(dragging ? 1.06 : 1, SPRING) },
        { rotate: withSpring(dragging ? "3deg" : "0deg", SPRING) },
      ],
      zIndex: dragging ? 10 : 1,
      shadowOpacity: withSpring(dragging ? 0.3 : 0, SPRING),
    };
  });

  const position = `Photo ${index + 1} of ${count}`;
  const accessibilityActions = [
    ...(index > 0
      ? [
          { name: "cover", label: "Make cover" },
          { name: "earlier", label: "Move earlier" },
        ]
      : []),
    ...(index < count - 1 ? [{ name: "later", label: "Move later" }] : []),
  ];

  return (
    <Animated.View
      style={[
        styles.tile,
        { width: tileSize, height: tileSize },
        animatedStyle,
      ]}
    >
      <GestureDetector gesture={pan}>
        <View
          style={styles.tileInner}
          accessible
          accessibilityLabel={index === 0 ? `${position}, cover` : position}
          accessibilityHint="Touch and hold, then drag to reorder"
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === "cover") onMove(photo.id, 0);
            if (action === "earlier") onMove(photo.id, index - 1);
            if (action === "later") onMove(photo.id, index + 1);
          }}
        >
          {photo.uri ? (
            <Image
              source={{ uri: photo.uri }}
              style={styles.tileImage}
              contentFit="cover"
              transition={150}
            />
          ) : null}
          {photo.isUploading ? (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator color="white" />
            </View>
          ) : null}
          {index === 0 ? (
            <View style={styles.coverBadge}>
              <Ionicons name="star" size={11} color="white" />
              <Text style={styles.coverText}>Cover</Text>
            </View>
          ) : null}
        </View>
      </GestureDetector>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${position.toLowerCase()}`}
        hitSlop={8}
        onPress={() => onRemove(photo.id)}
        style={({ pressed }) => [
          styles.removeButton,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="close" size={15} color="white" />
      </Pressable>
    </Animated.View>
  );
};

/**
 * All of a recipe's photos at a size you can work with: drag to reorder
 * (the first is the cover), remove, or add more.
 */
export const RecipePhotosSheet = forwardRef<
  RecipePhotosSheetRef,
  RecipePhotosSheetProps
>(
  (
    {
      photos,
      onReorder,
      onRemove,
      onAddPhoto,
      onCreateWithAI,
      isCreatingWithAI,
    },
    ref,
  ) => {
    const { theme } = useUnistyles();
    const { width } = useWindowDimensions();
    const sheetRef = useRef<TrueSheet>(null);
    const [isDragging, setIsDragging] = useState(false);
    const positions = useSharedValue<Positions>(positionsFrom(photos));

    useImperativeHandle(ref, () => ({
      present: () => {
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    // Start from the real order whenever the photos change (a drop has been
    // committed, or one was added or removed).
    useEffect(() => {
      positions.set(positionsFrom(photos));
    }, [photos, positions]);

    const tileSize = Math.floor(
      (width - SIDE_PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS,
    );
    const slotCount = photos.length + 1;
    const rows = Math.ceil(slotCount / COLUMNS);
    const gridHeight = rows * tileSize + (rows - 1) * GAP;
    const addSlot = slotOffset(photos.length, tileSize);

    const handleDrop = useCallback(() => {
      const current = positions.get();
      const ids = [...photos]
        .sort((a, b) => (current[a.id] ?? 0) - (current[b.id] ?? 0))
        .map((photo) => photo.id);
      if (ids.some((id, index) => id !== photos[index]?.id)) {
        onReorder(ids);
      }
    }, [onReorder, photos, positions]);

    const handleMove = useCallback(
      (id: string, to: number) => {
        positions.set(movePosition(positions.get(), id, to));
        handleDrop();
      },
      [handleDrop, positions],
    );

    return (
      <AppSheet
        ref={sheetRef}
        title="Photos"
        subtitle={photos.length > 1 ? "Hold and drag to reorder" : undefined}
        detents={[1]}
        scrollable
        backgroundColor={theme.colors.background}
      >
        {/* The sheet is its own native view tree, so gestures need a root here. */}
        <GestureHandlerRootView style={styles.gestureRoot}>
          <ScrollView
            scrollEnabled={!isDragging}
            contentContainerStyle={styles.content}
          >
            <View style={[styles.grid, { height: gridHeight }]}>
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={index}
                  count={photos.length}
                  tileSize={tileSize}
                  positions={positions}
                  onDragChange={setIsDragging}
                  onDrop={handleDrop}
                  onMove={handleMove}
                  onRemove={onRemove}
                />
              ))}

              <View
                style={[
                  styles.addTile,
                  {
                    width: tileSize,
                    height: tileSize,
                    transform: [
                      { translateX: addSlot.x },
                      { translateY: addSlot.y },
                    ],
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={onAddPhoto}
                  style={({ pressed }) => [
                    styles.addButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    style={styles.addIcon}
                  />
                  <Text style={styles.addText}>Add photo</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: isCreatingWithAI,
                    busy: isCreatingWithAI,
                  }}
                  disabled={isCreatingWithAI}
                  onPress={onCreateWithAI}
                  style={({ pressed }) => [
                    styles.addButton,
                    (pressed || isCreatingWithAI) && styles.pressed,
                  ]}
                >
                  {isCreatingWithAI ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons name="sparkles" size={17} style={styles.aiIcon} />
                  )}
                  <Text style={[styles.addText, styles.aiText]}>
                    Create with AI
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </GestureHandlerRootView>
      </AppSheet>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  gestureRoot: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 40,
  },
  grid: {
    position: "relative",
  },
  tile: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 22,
    borderCurve: "continuous",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 24,
  },
  tileInner: {
    flex: 1,
    borderRadius: 22,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: theme.colors.inputBackground,
  },
  tileImage: {
    width: "100%",
    height: "100%",
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  coverBadge: {
    position: "absolute",
    left: 10,
    bottom: 10,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.62)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  coverText: {
    color: "white",
    fontSize: 12,
    fontFamily: theme.fonts.bold,
  },
  removeButton: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  addTile: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 22,
    borderCurve: "continuous",
    backgroundColor: theme.colors.inputBackground,
    justifyContent: "center",
    gap: 8,
    padding: 14,
  },
  addButton: {
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.background,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
  },
  addIcon: {
    color: theme.colors.text,
  },
  addText: {
    color: theme.colors.text,
    fontSize: 15,
    fontFamily: theme.fonts.bold,
  },
  aiIcon: {
    color: theme.colors.onPrimarySoft,
  },
  aiText: {
    color: theme.colors.onPrimarySoft,
  },
  pressed: {
    opacity: 0.6,
  },
}));
