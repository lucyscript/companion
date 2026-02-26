/**
 * Microsoft Teams Client — Graph API
 *
 * Uses Microsoft Graph API to fetch:
 *   - Joined class teams
 *   - Assignments (Education API)
 *   - Channel messages / announcements
 *
 * Auth: OAuth 2.0 bearer token (delegated permissions via Microsoft identity platform).
 *
 * Graph API docs:
 *   https://learn.microsoft.com/en-us/graph/api/overview
 *   https://learn.microsoft.com/en-us/graph/api/educationclass-list-assignments
 */

import {
  TeamsClass,
  TeamsAssignment,
  TeamsAnnouncement
} from "./types.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class TeamsClient {
  private readonly accessToken: string | undefined;

  constructor(accessToken?: string) {
    this.accessToken = accessToken;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    if (!this.accessToken) {
      throw new Error("Microsoft Graph access token not configured");
    }

    const url = `${GRAPH_BASE}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json"
        }
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Graph API request failed for ${url}${reason}`);
    }

    if (!response.ok) {
      const responseBody = await response.text();
      const compactBody = responseBody.trim().slice(0, 200);
      const details = compactBody ? ` — ${compactBody}` : "";
      throw new Error(`Graph API error for ${url}: ${response.status} ${response.statusText}${details}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * List the user's joined education classes (Teams for Education).
   */
  async getClasses(): Promise<TeamsClass[]> {
    const data = await this.fetch<{ value: TeamsClass[] }>("/education/me/classes");
    return data.value ?? [];
  }

  /**
   * List assignments for a specific class.
   */
  async getClassAssignments(classId: string): Promise<TeamsAssignment[]> {
    const data = await this.fetch<{ value: TeamsAssignment[] }>(
      `/education/classes/${classId}/assignments`
    );
    return data.value ?? [];
  }

  /**
   * Fetch all assignments across all classes.
   */
  async getAllAssignments(classes: TeamsClass[]): Promise<TeamsAssignment[]> {
    const assignments: TeamsAssignment[] = [];
    for (const cls of classes) {
      try {
        const classAssignments = await this.getClassAssignments(cls.id);
        for (const a of classAssignments) {
          a.classId = cls.id;
        }
        assignments.push(...classAssignments);
      } catch (error) {
        console.error(`Failed to fetch Teams assignments for class ${cls.id}:`, error);
      }
    }
    return assignments;
  }

  /**
   * Fetch general channel messages (announcements) for a class team.
   * Only fetches the "General" channel by convention.
   */
  async getClassAnnouncements(classId: string): Promise<TeamsAnnouncement[]> {
    try {
      // Get channels, find General
      const channelsData = await this.fetch<{ value: Array<{ id: string; displayName: string }> }>(
        `/teams/${classId}/channels`
      );
      const general = channelsData.value?.find(c =>
        c.displayName.toLowerCase() === "general" || c.displayName.toLowerCase() === "generelt"
      );
      if (!general) return [];

      const messagesData = await this.fetch<{ value: TeamsAnnouncement[] }>(
        `/teams/${classId}/channels/${general.id}/messages?$top=10`
      );
      return messagesData.value ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch announcements across all classes.
   */
  async getAllAnnouncements(classes: TeamsClass[]): Promise<TeamsAnnouncement[]> {
    const announcements: TeamsAnnouncement[] = [];
    for (const cls of classes) {
      try {
        const classAnnouncements = await this.getClassAnnouncements(cls.id);
        announcements.push(...classAnnouncements);
      } catch (error) {
        console.error(`Failed to fetch Teams announcements for class ${cls.id}:`, error);
      }
    }
    return announcements;
  }
}
