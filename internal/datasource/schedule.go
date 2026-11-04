package datasource

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/vanderheijden86/b9s/pkg/debug"
	"github.com/vanderheijden86/b9s/pkg/model"
)

// scheduleQueries run in order until one succeeds. Older bd schemas lack
// close_reason or metadata, and the oldest lack started_at too; like creators, the schedule
// loads apart from the main query so a missing column costs only itself.
var scheduleQueries = []string{
	`SELECT id, started_at, metadata, close_reason FROM issues`,
	`SELECT id, started_at, metadata, NULL FROM issues`,
	`SELECT id, started_at, NULL, NULL FROM issues`,
}

// applySchedule fills StartedAt, CloseReason and PlannedStart (metadata.planned_start,
// an RFC 3339 time or a YYYY-MM-DD date) for the web timeline. A schema without
// the columns, or metadata that is not a JSON object, leaves the issue unchanged.
func applySchedule(db *sql.DB, issues []model.Issue) {
	if len(issues) == 0 {
		return
	}
	index := make(map[string]int, len(issues))
	for i := range issues {
		index[issues[i].ID] = i
	}
	for _, query := range scheduleQueries {
		rows, err := db.Query(query)
		if err != nil {
			debug.Log("schedule: %q failed: %v", query, err)
			continue
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var started sql.NullTime
			var meta, reason sql.NullString
			if err := rows.Scan(&id, &started, &meta, &reason); err != nil {
				continue
			}
			i, ok := index[id]
			if !ok {
				continue
			}
			if started.Valid && !started.Time.IsZero() {
				t := started.Time
				issues[i].StartedAt = &t
			}
			issues[i].PlannedStart = PlannedStart(meta.String)
			issues[i].CloseReason = reason.String
		}
		return
	}
}

// PlannedStart reads planned_start from an issue's metadata JSON; nil when
// absent or unreadable.
func PlannedStart(meta string) *time.Time {
	if meta == "" {
		return nil
	}
	var m struct {
		PlannedStart string `json:"planned_start"`
	}
	if json.Unmarshal([]byte(meta), &m) != nil || m.PlannedStart == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, m.PlannedStart); err == nil {
			return &t
		}
	}
	return nil
}
