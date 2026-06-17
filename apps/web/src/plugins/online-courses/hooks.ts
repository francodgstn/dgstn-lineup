'use client'

import { useQuery } from '@tanstack/react-query'
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, increment,
  setDoc, updateDoc, serverTimestamp, writeBatch, getCountFromServer,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  COURSES_COLLECTION,
  COURSE_MODULES_SUBCOLLECTION,
  COURSE_LESSONS_SUBCOLLECTION,
} from '@linyup/shared'
import type { Course, CourseModule, Lesson } from '@linyup/shared'

// ─── Helpers ────────────────────────────────────────────────────────────────

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'course'}-${suffix}`
}

function coursesCol() {
  return collection(db, COURSES_COLLECTION)
}
function modulesCol(courseId: string) {
  return collection(db, COURSES_COLLECTION, courseId, COURSE_MODULES_SUBCOLLECTION)
}
function lessonsCol(courseId: string) {
  return collection(db, COURSES_COLLECTION, courseId, COURSE_LESSONS_SUBCOLLECTION)
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useCourses(teamId: string | null) {
  return useQuery<Course[]>({
    queryKey: ['courses', teamId],
    enabled: !!teamId,
    queryFn: async () => {
      const snap = await getDocs(
        query(coursesCol(), where('teamId', '==', teamId), orderBy('created_at', 'desc')),
      )
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Course, 'id'>) }))
    },
  })
}

export function useCourse(courseId: string | null) {
  return useQuery<Course | null>({
    queryKey: ['course', courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const d = await getDoc(doc(coursesCol(), courseId!))
      return d.exists() ? ({ id: d.id, ...(d.data() as Omit<Course, 'id'>) }) : null
    },
  })
}

export function useModules(courseId: string | null) {
  return useQuery<CourseModule[]>({
    queryKey: ['course-modules', courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const snap = await getDocs(query(modulesCol(courseId!), orderBy('order', 'asc')))
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CourseModule, 'id'>) }))
    },
  })
}

export function useLessons(courseId: string | null) {
  return useQuery<Lesson[]>({
    queryKey: ['course-lessons', courseId],
    enabled: !!courseId,
    queryFn: async () => {
      const snap = await getDocs(query(lessonsCol(courseId!), orderBy('order', 'asc')))
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lesson, 'id'>) }))
    },
  })
}

// ─── Mutations (plain async helpers; call from useMutation in components) ──────

export async function createCourse(input: {
  teamId: string
  userId: string
  title: string
}): Promise<string> {
  const ref = doc(coursesCol())
  const payload = {
    scope: 'team' as const,
    teamId: input.teamId,
    title: input.title,
    slug: slugify(input.title),
    status: 'draft' as const,
    accessRule: { type: 'registered' as const },
    moduleCount: 0,
    lessonCount: 0,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    createdBy: input.userId,
  }
  await setDoc(ref, payload)
  return ref.id
}

export async function updateCourse(
  courseId: string,
  patch: Partial<Pick<Course, 'title' | 'summary' | 'coverImageUrl' | 'status' | 'accessRule' | 'archived_at'>>,
): Promise<void> {
  await updateDoc(doc(coursesCol(), courseId), { ...patch, updated_at: serverTimestamp() })
}

export async function deleteCourse(courseId: string): Promise<void> {
  // Delete subcollection docs first (client-side; course trees are small in MVP).
  const [mods, lessons] = await Promise.all([
    getDocs(modulesCol(courseId)),
    getDocs(lessonsCol(courseId)),
  ])
  const batch = writeBatch(db)
  mods.docs.forEach((d) => batch.delete(d.ref))
  lessons.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(coursesCol(), courseId))
  await batch.commit()
}

export async function createModule(input: {
  courseId: string
  teamId: string
  title: string
  order: number
}): Promise<void> {
  const ref = doc(modulesCol(input.courseId))
  const batch = writeBatch(db)
  batch.set(ref, {
    courseId: input.courseId,
    teamId: input.teamId,
    title: input.title,
    order: input.order,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
  batch.update(doc(coursesCol(), input.courseId), {
    moduleCount: increment(1),
    updated_at: serverTimestamp(),
  })
  await batch.commit()
}

export async function updateModule(
  courseId: string,
  moduleId: string,
  patch: Partial<Pick<CourseModule, 'title' | 'summary' | 'order'>>,
): Promise<void> {
  await updateDoc(doc(modulesCol(courseId), moduleId), { ...patch, updated_at: serverTimestamp() })
}

export async function deleteModule(courseId: string, moduleId: string): Promise<void> {
  // Remove the module and any lessons attached to it.
  const lessons = await getDocs(query(lessonsCol(courseId), where('moduleId', '==', moduleId)))
  const batch = writeBatch(db)
  batch.delete(doc(modulesCol(courseId), moduleId))
  lessons.docs.forEach((d) => batch.delete(d.ref))
  batch.update(doc(coursesCol(), courseId), {
    moduleCount: increment(-1),
    lessonCount: increment(-lessons.size),
    updated_at: serverTimestamp(),
  })
  await batch.commit()
}

export type LessonInput = Pick<
  Lesson,
  'title' | 'type' | 'body' | 'mediaSource' | 'mediaUrl' | 'durationSeconds' | 'attachments'
>

export async function createLesson(input: {
  courseId: string
  teamId: string
  moduleId: string
  order: number
  data: LessonInput
}): Promise<string> {
  const ref = doc(lessonsCol(input.courseId))
  const batch = writeBatch(db)
  batch.set(ref, {
    courseId: input.courseId,
    teamId: input.teamId,
    moduleId: input.moduleId,
    order: input.order,
    ...stripUndefined(input.data),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
  batch.update(doc(coursesCol(), input.courseId), {
    lessonCount: increment(1),
    updated_at: serverTimestamp(),
  })
  await batch.commit()
  return ref.id
}

export async function updateLesson(
  courseId: string,
  lessonId: string,
  data: Partial<LessonInput>,
): Promise<void> {
  await updateDoc(doc(lessonsCol(courseId), lessonId), {
    ...stripUndefined(data),
    updated_at: serverTimestamp(),
  })
}

export async function deleteLesson(courseId: string, lessonId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.delete(doc(lessonsCol(courseId), lessonId))
  batch.update(doc(coursesCol(), courseId), {
    lessonCount: increment(-1),
    updated_at: serverTimestamp(),
  })
  await batch.commit()
}

// Live course count for the team — used to enforce the per-team course cap even
// when the cached list query is stale.
export async function countCourses(teamId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(coursesCol(), where('teamId', '==', teamId)),
  )
  return snap.data().count
}

// Firestore rejects `undefined` field values; drop them before writing.
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>
}
