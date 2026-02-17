import type { ReactNode } from "react";
import { useSwipeAction } from "../hooks/useSwipeAction";

interface SwipeableListItemProps {
  children: ReactNode;
  itemId?: string;
  className?: string;
  disabled?: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftActionLabel?: string;
  rightActionLabel?: string;
}

export function SwipeableListItem({
  children,
  itemId,
  className,
  disabled = false,
  onSwipeLeft,
  onSwipeRight,
  leftActionLabel = "Left action",
  rightActionLabel = "Right action"
}: SwipeableListItemProps): JSX.Element {
  const swipe = useSwipeAction({
    onSwipeLeft,
    onSwipeRight,
    disabled
  });

  return (
    <li id={itemId} className="swipeable-list-item">
      <div className="swipeable-actions-layer">
        <div className={`swipeable-action swipeable-action-right ${swipe.offsetX > 0 ? "swipeable-action-visible" : ""}`}>
          {rightActionLabel}
        </div>
        <div className={`swipeable-action swipeable-action-left ${swipe.offsetX < 0 ? "swipeable-action-visible" : ""}`}>
          {leftActionLabel}
        </div>
      </div>

      <div
        className={`swipeable-content ${className ?? ""}`}
        style={{ transform: `translateX(${swipe.offsetX}px)` }}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchCancel}
      >
        {children}
      </div>
    </li>
  );
}
