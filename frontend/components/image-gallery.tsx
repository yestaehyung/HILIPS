"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Search, ArrowUpDown, Eye, Loader2, CheckCircle, ChevronLeft, ChevronRight, FlaskConical } from "lucide-react"

interface ImageGalleryProps {
  images: string[]
  loading: boolean
  error: string | null
  onImageSelect: (image: string) => void
  annotations?: Record<string, any[]>
  testSetImages?: Record<string, string>
  currentPage?: number
  onPageChange?: (page: number) => void
  searchTerm?: string
  onSearchChange?: (term: string) => void
  sortOrder?: "asc" | "desc"
  onSortChange?: (order: "asc" | "desc") => void
}

const PAGE_SIZE = 20

export default function ImageGallery({ 
  images, 
  loading, 
  error, 
  onImageSelect, 
  annotations = {},
  testSetImages = {},
  currentPage = 1,
  onPageChange,
  searchTerm = "",
  onSearchChange,
  sortOrder = "asc",
  onSortChange
}: ImageGalleryProps) {
  // const [searchTerm, setSearchTerm] = useState("") - Removed internal state
  // const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc") - Removed internal state
  // const [currentPage, setCurrentPage] = useState(1) - Removed internal state

  // Filter logic moved to parent
  const filteredImages = images
  //   .filter((img) => img.toLowerCase().includes(searchTerm.toLowerCase()))
  //   .sort((a, b) => {
  //     if (sortOrder === "asc") {
  //       return a.localeCompare(b)
  //     } else {
  //       return b.localeCompare(a)
  //     }
  //   })

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE))
  const clampedPage = Math.min(currentPage, totalPages)
  const startIndex = (clampedPage - 1) * PAGE_SIZE
  const paginatedImages = filteredImages.slice(startIndex, startIndex + PAGE_SIZE)

  useEffect(() => {
    if (onPageChange) {
      onPageChange(1)
    }
  }, [searchTerm, onPageChange])

  useEffect(() => {
    if (currentPage > totalPages && onPageChange) {
      onPageChange(totalPages)
    }
  }, [currentPage, totalPages, onPageChange])

  const handleSort = () => {
    onSortChange?.(sortOrder === "asc" ? "desc" : "asc")
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading images...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6">
        <div className="flex items-center space-x-2 text-destructive">
          <span className="text-lg">⚠️</span>
          <span className="font-medium">{error}</span>
        </div>
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">📁</div>
        <h3 className="text-lg font-medium mb-2">No images found</h3>
        <p className="text-muted-foreground">Upload some images to get started</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Image Grid - Masonry Layout */}
      <div className="columns-1 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
        {paginatedImages.map((image) => (
          <div key={image} className="break-inside-avoid">
            <Card className="group overflow-hidden hover:shadow-lg transition-shadow border-0 bg-card/50 backdrop-blur">
              <CardContent className="p-0">
                <div className="relative overflow-hidden">
                  <img
                    src={`/images/${image}`}
                    alt={image}
                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-110"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Button
                      size="sm"
                      className="transform translate-y-4 group-hover:translate-y-0 transition-all duration-300"
                      onClick={() => onImageSelect(image)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Label
                    </Button>
                  </div>
                  {testSetImages[image] && (
                    <div className="absolute top-2 left-2 z-10">
                      <Badge variant="default" className="bg-purple-600 hover:bg-purple-700 border-0 shadow-sm">
                        <FlaskConical className="w-3 h-3 mr-1" />
                        GT
                      </Badge>
                    </div>
                  )}
                  {annotations && annotations[image] && annotations[image].length > 0 && (
                    <div className="absolute top-2 right-2 z-10">
                      <Badge variant="default" className="bg-green-500 hover:bg-green-600 border-0 shadow-sm">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        {annotations[image].length}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="p-3 bg-card/80 backdrop-blur absolute bottom-0 left-0 right-0 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                  <p className="text-xs font-medium truncate text-center" title={image}>
                    {image}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {filteredImages.length > PAGE_SIZE && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium">{startIndex + 1}</span>-
            <span className="font-medium">{Math.min(startIndex + PAGE_SIZE, filteredImages.length)}</span> of{" "}
            <span className="font-medium">{filteredImages.length}</span> images
          </p>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
              disabled={clampedPage === 1}
              className="bg-transparent"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <span className="text-sm font-medium">
              Page {clampedPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(Math.min(totalPages, currentPage + 1))}
              disabled={clampedPage === totalPages}
              className="bg-transparent"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
