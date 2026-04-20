"use client"

import { useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Keyboard } from "lucide-react"

interface KeyboardShortcut {
  key: string
  description: string
  action: () => void
}

interface KeyboardShortcutsProps {
  shortcuts: KeyboardShortcut[]
  enabled?: boolean
}

export default function KeyboardShortcuts({ shortcuts, enabled = true }: KeyboardShortcutsProps) {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return
      }

      const shortcut = shortcuts.find((s) => {
        const keys = s.key.toLowerCase().split("+")
        const pressedKeys = []

        if (event.ctrlKey || event.metaKey) pressedKeys.push("ctrl")
        if (event.shiftKey) pressedKeys.push("shift")
        if (event.altKey) pressedKeys.push("alt")
        pressedKeys.push(event.key.toLowerCase())

        return keys.every((key) => pressedKeys.includes(key)) && keys.length === pressedKeys.length
      })

      if (shortcut) {
        event.preventDefault()
        shortcut.action()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [shortcuts, enabled])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Keyboard className="mr-2 h-4 w-4" />
          Keyboard Shortcuts
        </CardTitle>
        <CardDescription>Use these shortcuts to speed up your workflow</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shortcuts.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded">
              <span className="text-sm">{shortcut.description}</span>
              <Badge variant="outline" className="font-mono text-xs">
                {shortcut.key.split("+").map((key, i) => (
                  <span key={i}>
                    {i > 0 && " + "}
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </span>
                ))}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
